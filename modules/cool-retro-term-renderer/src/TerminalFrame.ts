/**
 * TerminalFrame - Three.js implementation of the CRT frame
 *
 * Faithfully ported from cool-retro-term TerminalFrame.qml + terminal_frame.frag.
 * Renders the CRT bezel/frame overlay with:
 * - SDF rounded rectangle for smooth screen edges
 * - Seam shading (N/S/E/W directional lighting on the bezel)
 * - Glass reflection on the screen area
 * - Dithering noise on the frame surface
 * - Proper alpha blending
 *
 * Color computation matches QML TerminalFrame.qml:
 *   _staticFrameColor = sum(appSettings.frameColor, rgba(0.1, 0.1, 0.1, 1.0))
 *   _lightColor       = mix(_fontColor, _backgroundColor, 0.2)
 *   frameColor         = mix(scaleColor(_lightColor, 0.2),
 *                            _staticFrameColor,
 *                            0.125 + 0.750 * ambientLight)
 */

import * as THREE from "three";
import {
	terminalFrameFragmentShader,
	terminalFrameVertexShader,
} from "./shaders/terminalFrame";
import {
	type Color,
	clamp,
	colorToVec4,
	hexToColor,
	lint,
	mixColors,
} from "./utils";

/**
 * Clamp-add two colors component-wise (matching QML Utils.sum).
 */
function sumColors(c1: Color, c2: Color): Color {
	return {
		r: clamp(c1.r + c2.r, 0, 1),
		g: clamp(c1.g + c2.g, 0, 1),
		b: clamp(c1.b + c2.b, 0, 1),
		a: clamp(c1.a + c2.a, 0, 1),
	};
}

/**
 * Scale a color's RGB channels by a scalar (matching QML Utils.scaleColor).
 */
function scaleColor(c: Color, value: number): Color {
	return {
		r: clamp(c.r * value, 0, 1),
		g: clamp(c.g * value, 0, 1),
		b: clamp(c.b * value, 0, 1),
		a: clamp(c.a, 0, 1),
	};
}

/**
 * QML-style mix: mix(c1, c2, alpha) = c1*(1-alpha) + c2*alpha
 * Note: this is the QML convention, which is the INVERSE of our mixColors().
 */
function qmlMix(c1: Color, c2: Color, alpha: number): Color {
	return {
		r: c1.r * (1 - alpha) + c2.r * alpha,
		g: c1.g * (1 - alpha) + c2.g * alpha,
		b: c1.b * (1 - alpha) + c2.b * alpha,
		a: c1.a * (1 - alpha) + c2.a * alpha,
	};
}

export class TerminalFrame {
	public mesh: THREE.Mesh;
	private material: THREE.ShaderMaterial;
	private uniforms: {
		screenCurvature: { value: number };
		frameColor: { value: THREE.Vector4 };
		frameSize: { value: number };
		screenRadius: { value: number };
		viewportSize: { value: THREE.Vector2 };
		ambientLight: { value: number };
		frameShininess: { value: number };
	};

	// Raw user-facing settings (0-1 range, matching QML _ prefixed properties)
	private _frameColorHex = "#ffffff";
	private _fontColorHex = "#0ccc68";
	private _backgroundColorHex = "#000000";
	private _ambientLight = 0.2;
	private _frameShininess = 0.2; // raw 0-1
	private _frameSize = 0.2; // raw 0-1
	private _screenRadius = 0.2; // raw 0-1
	private _screenCurvature = 0.3;
	private _screenCurvatureSize = 1.0;

	// Viewport logical size (CSS pixels, not device pixels)
	private viewportWidth: number;
	private viewportHeight: number;

	constructor(width: number, height: number) {
		this.viewportWidth = width;
		this.viewportHeight = height;

		this.uniforms = {
			screenCurvature: { value: 0 },
			frameColor: { value: new THREE.Vector4(1, 1, 1, 1) },
			frameSize: { value: 0 },
			screenRadius: { value: 0 },
			viewportSize: { value: new THREE.Vector2(width, height) },
			ambientLight: { value: 0 },
			frameShininess: { value: 0 },
		};

		this.material = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: terminalFrameVertexShader,
			fragmentShader: terminalFrameFragmentShader,
			transparent: true,
			side: THREE.DoubleSide,
			blending: THREE.NormalBlending,
			depthWrite: false,
		});

		const geometry = new THREE.PlaneGeometry(2, 2);
		this.mesh = new THREE.Mesh(geometry, this.material);

		// Apply all derived uniforms from defaults
		this.recomputeUniforms();
	}

	// ──────────────────────────────────────────────
	// Internal helpers
	// ──────────────────────────────────────────────

	/**
	 * normalizedWindowScale from QML:
	 *   1024 / (0.5 * width + 0.5 * height)
	 *
	 * Used to make curvature and frame size look consistent
	 * regardless of the window dimensions.
	 */
	private get normalizedWindowScale(): number {
		return 1024 / (0.5 * this.viewportWidth + 0.5 * this.viewportHeight);
	}

	/**
	 * Recompute all derived uniform values from the raw settings.
	 * This mirrors the property bindings in QML TerminalFrame.qml.
	 */
	private recomputeUniforms(): void {
		const nws = this.normalizedWindowScale;

		// screenCurvature = appSettings.screenCurvature * screenCurvatureSize * normalizedWindowScale
		this.uniforms.screenCurvature.value =
			this._screenCurvature * this._screenCurvatureSize * nws;

		// frameSize = _frameSize * 0.05 * normalizedWindowScale
		this.uniforms.frameSize.value = this._frameSize * 0.05 * nws;

		// screenRadius = lint(4.0, 120.0, _screenRadius)
		this.uniforms.screenRadius.value = lint(4.0, 120.0, this._screenRadius);

		// frameShininess = _frameShininess * 0.5
		this.uniforms.frameShininess.value = this._frameShininess * 0.5;

		// ambientLight (passed through directly)
		this.uniforms.ambientLight.value = this._ambientLight;

		// viewportSize = logical pixels (not device pixels), matching QML:
		//   Qt.size(width / windowScaling, height / windowScaling)
		// windowScaling is 1.0 in the port
		this.uniforms.viewportSize.value.set(
			this.viewportWidth,
			this.viewportHeight,
		);

		// Compute frameColor (matching QML TerminalFrame.qml)
		this.recomputeFrameColor();
	}

	/**
	 * Recompute the frameColor uniform.
	 *
	 * QML TerminalFrame.qml:
	 *   _staticFrameColor = sum(appSettings.frameColor, rgba(0.1, 0.1, 0.1, 1.0))
	 *   _lightColor       = mix(_fontColor, _backgroundColor, 0.2)
	 *   frameColor         = mix(scaleColor(_lightColor, 0.2),
	 *                            _staticFrameColor,
	 *                            0.125 + 0.750 * ambientLight)
	 */
	private recomputeFrameColor(): void {
		const rawFrameColor = hexToColor(this._frameColorHex);
		const fontColor = hexToColor(this._fontColorHex);
		const bgColor = hexToColor(this._backgroundColorHex);

		// _staticFrameColor = sum(frameColor, rgba(0.1, 0.1, 0.1, 1.0))
		const bump: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1.0 };
		const staticFrameColor = sumColors(rawFrameColor, bump);

		// _lightColor = QML mix(_fontColor, _backgroundColor, 0.2)
		//             = fontColor * 0.8 + bgColor * 0.2
		const lightColor = qmlMix(fontColor, bgColor, 0.2);

		// frameColor = QML mix(scaleColor(_lightColor, 0.2),
		//                      _staticFrameColor,
		//                      0.125 + 0.750 * ambientLight)
		const scaledLight = scaleColor(lightColor, 0.2);
		const mixAlpha = 0.125 + 0.75 * this._ambientLight;
		const finalColor = qmlMix(scaledLight, staticFrameColor, mixAlpha);

		this.uniforms.frameColor.value.set(
			finalColor.r,
			finalColor.g,
			finalColor.b,
			finalColor.a,
		);
	}

	// ──────────────────────────────────────────────
	// Public API
	// ──────────────────────────────────────────────

	/**
	 * Update the viewport size (call on window resize).
	 * Accepts logical (CSS) pixel dimensions.
	 */
	updateSize(width: number, height: number): void {
		this.viewportWidth = width;
		this.viewportHeight = height;
		this.recomputeUniforms();
	}

	/**
	 * Set the screen curvature amount (0-1).
	 * This is the raw user-facing value (appSettings.screenCurvature).
	 */
	setScreenCurvature(curvature: number): void {
		this._screenCurvature = curvature;
		this.uniforms.screenCurvature.value =
			curvature * this._screenCurvatureSize * this.normalizedWindowScale;
	}

	/**
	 * Set the frame size (0-1).
	 * This is the raw _frameSize from QML (not the derived value).
	 *   derived = _frameSize * 0.05 * normalizedWindowScale
	 */
	setFrameSize(size: number): void {
		this._frameSize = size;
		this.uniforms.frameSize.value = size * 0.05 * this.normalizedWindowScale;
	}

	/**
	 * Set the screen corner radius (0-1).
	 * This is the raw _screenRadius from QML.
	 *   derived = lint(4.0, 120.0, _screenRadius)
	 */
	setScreenRadius(radius: number): void {
		this._screenRadius = radius;
		this.uniforms.screenRadius.value = lint(4.0, 120.0, radius);
	}

	/**
	 * Set the frame shininess (0-1).
	 * This is the raw _frameShininess from QML.
	 *   derived = _frameShininess * 0.5
	 */
	setFrameShininess(shininess: number): void {
		this._frameShininess = shininess;
		this.uniforms.frameShininess.value = shininess * 0.5;
	}

	/**
	 * Set the ambient light level (0-1).
	 * Affects both frame color computation and glass visibility.
	 */
	setAmbientLight(ambient: number): void {
		this._ambientLight = ambient;
		this.uniforms.ambientLight.value = ambient;
		// Ambient light affects the frame color computation
		this.recomputeFrameColor();
	}

	/**
	 * Set the frame color (hex string, e.g. "#ffffff").
	 * This is the raw _frameColor from QML appSettings.
	 */
	setFrameColor(hex: string): void {
		this._frameColorHex = hex;
		this.recomputeFrameColor();
	}

	/**
	 * Set the font color used for frame color derivation (hex string).
	 * Should match the terminal's font color setting.
	 */
	setFontColor(hex: string): void {
		this._fontColorHex = hex;
		this.recomputeFrameColor();
	}

	/**
	 * Set the background color used for frame color derivation (hex string).
	 * Should match the terminal's background color setting.
	 */
	setBackgroundColor(hex: string): void {
		this._backgroundColorHex = hex;
		this.recomputeFrameColor();
	}

	/**
	 * Dispose of GPU resources.
	 */
	dispose(): void {
		this.material.dispose();
		(this.mesh.geometry as THREE.BufferGeometry).dispose();
	}
}
