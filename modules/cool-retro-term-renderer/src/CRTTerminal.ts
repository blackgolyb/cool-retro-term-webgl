/**
 * CRTTerminal - Main class for cool-retro-term-webgl
 *
 * This class encapsulates the Three.js scene, shaders, and rendering pipeline
 * for creating a CRT terminal effect. It accepts an XTerm.js terminal instance
 * and renders its output with authentic CRT visual effects.
 *
 * @example
 * ```typescript
 * import { CRTTerminal } from 'cool-retro-term-webgl';
 * import { Terminal } from '@xterm/xterm';
 *
 * const container = document.getElementById('terminal');
 * const crt = new CRTTerminal({ container });
 *
 * const xterm = new Terminal();
 * crt.attachXTerm(xterm);
 *
 * xterm.write('Hello, World!');
 * ```
 */

import type { Terminal } from "@xterm/xterm";
import * as THREE from "three";
import { TerminalFrame } from "./TerminalFrame";
import { TerminalText } from "./TerminalText";
import { XTermConnector } from "./XTermConnector";
import { type CRTTerminalSettings, DEFAULT_SETTINGS } from "./types";
import { type Color, hexToColor, mixColors } from "./utils";

export class CRTTerminal {
	private container: HTMLElement;
	private scene: THREE.Scene;
	private camera: THREE.OrthographicCamera;
	private renderer: THREE.WebGLRenderer;
	private terminalText: TerminalText;
	private terminalFrame: TerminalFrame;
	private animationFrameId: number | null = null;
	private connector: XTermConnector | null = null;
	private settings: Required<Omit<CRTTerminalSettings, "container">>;
	private disposed = false;

	constructor(options: CRTTerminalSettings) {
		this.container = options.container;
		this.settings = { ...DEFAULT_SETTINGS, ...options };

		// Create the Three.js scene
		this.scene = new THREE.Scene();

		// Create orthographic camera for 2D rendering
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		this.camera.position.z = 1;

		// Create the renderer
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setSize(
			this.container.clientWidth,
			this.container.clientHeight,
		);
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setClearColor(0x000000);
		this.container.appendChild(this.renderer.domElement);

		// Create the terminal text renderer
		this.terminalText = new TerminalText(
			this.container.clientWidth,
			this.container.clientHeight,
		);
		this.terminalText.mesh.position.z = 0;
		this.scene.add(this.terminalText.mesh);

		// Create the terminal frame
		this.terminalFrame = new TerminalFrame(
			this.container.clientWidth,
			this.container.clientHeight,
		);
		this.terminalFrame.mesh.position.z = 0.1;
		this.scene.add(this.terminalFrame.mesh);

		// Apply initial settings
		this.applySettings();

		// Handle window resize
		window.addEventListener("resize", this.handleResize);

		// Start the animation loop
		this.animate();
	}

	/**
	 * Compute derived fontColor and backgroundColor from raw colors,
	 * saturationColor, and contrast — matching QML ApplicationSettings.qml:
	 *
	 *   saturatedColor = mix(_fontColor, #FFFFFF, saturationColor * 0.5)
	 *   fontColor = mix(_backgroundColor, saturatedColor, 0.7 + contrast * 0.3)
	 *   backgroundColor = mix(saturatedColor, _backgroundColor, 0.7 + contrast * 0.3)
	 */
	private computeDerivedColors(): { fontColor: Color; backgroundColor: Color } {
		const rawFont = hexToColor(this.settings.fontColor);
		const rawBg = hexToColor(this.settings.backgroundColor);
		const white: Color = { r: 1, g: 1, b: 1, a: 1 };

		// saturatedColor = mix(_fontColor, white, saturationColor * 0.5)
		// QML mix(c1, c2, alpha) = c1*(1-alpha) + c2*alpha
		// Our mixColors(c1, c2, alpha) = c1*alpha + c2*(1-alpha)
		// So QML mix(rawFont, white, sat*0.5) = mixColors(white, rawFont, sat*0.5)
		const satAmount = this.settings.saturationColor * 0.5;
		const saturatedColor: Color = {
			r: rawFont.r * (1 - satAmount) + white.r * satAmount,
			g: rawFont.g * (1 - satAmount) + white.g * satAmount,
			b: rawFont.b * (1 - satAmount) + white.b * satAmount,
			a: 1,
		};

		const mixFactor = 0.7 + this.settings.contrast * 0.3;

		// fontColor = QML mix(_backgroundColor, saturatedColor, mixFactor)
		//           = _backgroundColor * (1 - mixFactor) + saturatedColor * mixFactor
		const derivedFont: Color = {
			r: rawBg.r * (1 - mixFactor) + saturatedColor.r * mixFactor,
			g: rawBg.g * (1 - mixFactor) + saturatedColor.g * mixFactor,
			b: rawBg.b * (1 - mixFactor) + saturatedColor.b * mixFactor,
			a: 1,
		};

		// backgroundColor = QML mix(saturatedColor, _backgroundColor, mixFactor)
		//                  = saturatedColor * (1 - mixFactor) + _backgroundColor * mixFactor
		const derivedBg: Color = {
			r: saturatedColor.r * (1 - mixFactor) + rawBg.r * mixFactor,
			g: saturatedColor.g * (1 - mixFactor) + rawBg.g * mixFactor,
			b: saturatedColor.b * (1 - mixFactor) + rawBg.b * mixFactor,
			a: 1,
		};

		return { fontColor: derivedFont, backgroundColor: derivedBg };
	}

	/**
	 * Apply the current settings to the terminal renderer
	 *
	 * Colors are derived from fontColor, backgroundColor, saturationColor,
	 * and contrast — matching QML ApplicationSettings.qml exactly.
	 */
	private applySettings(): void {
		const s = this.settings;

		// Compute derived colors from raw colors + saturation + contrast
		this.applyDerivedColors();

		this.terminalText.setScreenCurvature(s.screenCurvature);
		this.terminalText.setRgbShift(s.rgbShift);
		this.terminalText.setBloom(s.bloom);
		this.terminalText.setBrightness(s.brightness);
		this.terminalText.setAmbientLight(s.ambientLight);
		this.terminalText.setChromaColor(s.chromaColor);
		this.terminalText.setFlickering(s.flickering);
		this.terminalText.setHorizontalSync(s.horizontalSync);
		this.terminalText.setJitter(s.jitter);
		this.terminalText.setStaticNoise(s.staticNoise);
		this.terminalText.setGlowingLine(s.glowingLine);
		this.terminalText.setBurnIn(s.burnIn);
		this.terminalText.setRasterizationMode(s.rasterizationMode);
		this.terminalText.setRasterizationIntensity(s.rasterizationIntensity);

		// Frame settings (matching QML TerminalFrame.qml)
		this.terminalFrame.setScreenCurvature(s.screenCurvature);
		this.terminalFrame.setFrameSize(s.frameSize);
		this.terminalFrame.setScreenRadius(s.screenRadius);
		this.terminalFrame.setFrameShininess(s.frameShininess);
		this.terminalFrame.setAmbientLight(s.ambientLight);
		this.terminalFrame.setFrameColor(s.frameColor);
	}

	/**
	 * Recompute and apply derived font/background colors to the renderer.
	 * Called whenever fontColor, backgroundColor, saturationColor, or contrast change.
	 */
	private applyDerivedColors(): void {
		const { fontColor, backgroundColor } = this.computeDerivedColors();

		const fontHex = `#${Math.round(fontColor.r * 255)
			.toString(16)
			.padStart(2, "0")}${Math.round(fontColor.g * 255)
			.toString(16)
			.padStart(2, "0")}${Math.round(fontColor.b * 255)
			.toString(16)
			.padStart(2, "0")}`;
		const bgHex = `#${Math.round(backgroundColor.r * 255)
			.toString(16)
			.padStart(2, "0")}${Math.round(backgroundColor.g * 255)
			.toString(16)
			.padStart(2, "0")}${Math.round(backgroundColor.b * 255)
			.toString(16)
			.padStart(2, "0")}`;

		this.terminalText.setFontColor(fontHex);
		this.terminalText.setBackgroundColor(bgHex);

		// Pass derived colors to frame so it can compute its tint
		// (QML TerminalFrame.qml uses _fontColor and _backgroundColor)
		this.terminalFrame.setFontColor(fontHex);
		this.terminalFrame.setBackgroundColor(bgHex);
	}

	/**
	 * Handle window resize events
	 */
	private handleResize = (): void => {
		if (this.disposed) return;

		const width = this.container.clientWidth;
		const height = this.container.clientHeight;

		this.renderer.setSize(width, height);
		this.terminalText.updateSize(width, height);
		this.terminalFrame.updateSize(width, height);

		// Resize XTerm to match the new grid size
		if (this.connector) {
			const gridSize = this.terminalText.getGridSize();
			if (gridSize.cols > 0 && gridSize.rows > 0) {
				this.connector.getXTerm().resize(gridSize.cols, gridSize.rows);
				this.connector.sync();
			}
		}
	};

	/**
	 * Animation loop
	 */
	private animate = (): void => {
		if (this.disposed) return;

		this.animationFrameId = requestAnimationFrame(this.animate);

		// Update time for dynamic shader effects
		this.terminalText.updateTime(performance.now());

		// Render static pass first (to render target)
		this.terminalText.renderStaticPass(this.renderer);

		// Render the main scene
		this.renderer.render(this.scene, this.camera);
	};

	/**
	 * Attach an XTerm.js terminal instance to this CRT renderer
	 *
	 * This creates a connector that syncs the XTerm buffer to the CRT display.
	 * The XTerm terminal should be fully configured before attaching.
	 *
	 * @param xterm The XTerm.js Terminal instance to attach
	 */
	attachXTerm(xterm: Terminal): void {
		if (this.connector) {
			this.connector.dispose();
		}

		// Resize XTerm to match the terminal grid size
		const gridSize = this.terminalText.getGridSize();
		if (gridSize.cols > 0 && gridSize.rows > 0) {
			xterm.resize(gridSize.cols, gridSize.rows);
		}

		// Create the connector
		this.connector = new XTermConnector(xterm, this.terminalText);

		// Setup mouse selection on the container
		this.connector.setupMouseSelection(this.container);

		// Listen for grid size changes and resize XTerm accordingly
		this.terminalText.onGridSizeChange((cols, rows) => {
			if (cols > 0 && rows > 0 && this.connector) {
				this.connector.getXTerm().resize(cols, rows);
				this.connector.sync();
			}
		});

		// Initial sync
		this.connector.sync();
	}

	/**
	 * Detach the currently attached XTerm instance
	 */
	detachXTerm(): void {
		if (this.connector) {
			this.connector.dispose();
			this.connector = null;
		}
	}

	/**
	 * Get the current grid size (columns and rows)
	 */
	getGridSize(): { cols: number; rows: number } {
		return this.terminalText.getGridSize();
	}

	/**
	 * Get the TerminalText renderer (for advanced usage)
	 */
	getTerminalText(): TerminalText {
		return this.terminalText;
	}

	/**
	 * Get the Three.js renderer (for advanced usage)
	 */
	getRenderer(): THREE.WebGLRenderer {
		return this.renderer;
	}

	/**
	 * Get the Three.js scene (for advanced usage)
	 */
	getScene(): THREE.Scene {
		return this.scene;
	}

	/**
	 * Get the Three.js camera (for advanced usage)
	 */
	getCamera(): THREE.OrthographicCamera {
		return this.camera;
	}

	/**
	 * Focus the attached XTerm terminal for keyboard input
	 */
	focus(): void {
		if (this.connector) {
			this.connector.getXTerm().focus();
		}
	}

	/**
	 * Dispose of all resources
	 */
	dispose(): void {
		this.disposed = true;

		// Stop animation loop
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		// Remove event listeners
		window.removeEventListener("resize", this.handleResize);

		// Dispose connector
		if (this.connector) {
			this.connector.dispose();
			this.connector = null;
		}

		// Dispose Three.js resources
		this.terminalText.dispose();
		this.terminalFrame.dispose();
		this.renderer.dispose();

		// Remove renderer from DOM
		if (this.renderer.domElement.parentNode) {
			this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
		}
	}
}
