/**
 * Utility functions for cool-retro-term-webgl
 */

export interface Color {
	r: number;
	g: number;
	b: number;
	a: number;
}

/**
 * Clamp a value between min and max
 */
export function clamp(x: number, min: number, max: number): number {
	if (x <= min) return min;
	if (x >= max) return max;
	return x;
}

/**
 * Linear interpolation between a and b by factor t
 * lint(a, b, t) = (1 - t) * a + t * b
 */
export function lint(a: number, b: number, t: number): number {
	return (1 - t) * a + t * b;
}

/**
 * Mix two colors by alpha factor
 * alpha = 1 means 100% c1, alpha = 0 means 100% c2
 */
export function mixColors(c1: Color, c2: Color, alpha: number): Color {
	return {
		r: c1.r * alpha + c2.r * (1 - alpha),
		g: c1.g * alpha + c2.g * (1 - alpha),
		b: c1.b * alpha + c2.b * (1 - alpha),
		a: c1.a * alpha + c2.a * (1 - alpha),
	};
}

/**
 * Parse a hex color string to Color object
 */
export function hexToColor(hex: string): Color {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!result) {
		return { r: 1, g: 1, b: 1, a: 1 };
	}
	return {
		r: Number.parseInt(result[1], 16) / 255,
		g: Number.parseInt(result[2], 16) / 255,
		b: Number.parseInt(result[3], 16) / 255,
		a: 1,
	};
}

/**
 * Convert Color to THREE.js compatible array [r, g, b]
 */
export function colorToVec3(color: Color): [number, number, number] {
	return [color.r, color.g, color.b];
}

/**
 * Convert Color to THREE.js compatible array [r, g, b, a]
 */
export function colorToVec4(color: Color): [number, number, number, number] {
	return [color.r, color.g, color.b, color.a];
}

/**
 * Inverse barrel distortion: given a pixel position on screen, compute
 * where that pixel would be on the undistorted (flat) terminal surface.
 *
 * The barrel distortion in the shader is:
 *   cc = vec2(0.5) - uv
 *   ccCorrected = cc (with aspect ratio correction)
 *   dist = dot(ccCorrected, ccCorrected) * curvature
 *   distorted = uv - cc * (1 + dist) * dist
 *
 * This function approximates the inverse using iterative refinement.
 *
 * @param pixelX - X pixel coordinate on screen
 * @param pixelY - Y pixel coordinate on screen
 * @param width - Screen width in pixels
 * @param height - Screen height in pixels
 * @param curvature - Curvature amount (same value passed to shader)
 * @returns Corrected pixel coordinates on the flat terminal surface
 */
export function projectPixelWithCurvature(
	pixelX: number,
	pixelY: number,
	width: number,
	height: number,
	curvature: number,
): { x: number; y: number } {
	if (curvature <= 0) {
		return { x: pixelX, y: pixelY };
	}

	// Normalize to UV space [0, 1]
	const targetU = pixelX / width;
	const targetV = pixelY / height;

	// Aspect ratio correction (matching the shader)
	const aspectRatio = width / height;

	// Forward barrel distortion function
	function barrelDistort(u: number, v: number): { u: number; v: number } {
		const ccX = 0.5 - u;
		const ccY = 0.5 - v;

		let ccCorrX = ccX;
		let ccCorrY = ccY;
		if (aspectRatio > 1.0) {
			ccCorrX /= aspectRatio;
		} else {
			ccCorrY *= aspectRatio;
		}

		const dist = (ccCorrX * ccCorrX + ccCorrY * ccCorrY) * curvature;
		const factor = (1.0 + dist) * dist;

		return {
			u: u - ccX * factor,
			v: v - ccY * factor,
		};
	}

	// Iterative inverse: start with target and refine
	let guessU = targetU;
	let guessV = targetV;

	for (let i = 0; i < 10; i++) {
		const distorted = barrelDistort(guessU, guessV);
		const errorU = distorted.u - targetU;
		const errorV = distorted.v - targetV;

		guessU -= errorU;
		guessV -= errorV;

		// Early exit if converged
		if (Math.abs(errorU) < 1e-6 && Math.abs(errorV) < 1e-6) {
			break;
		}
	}

	// Convert back to pixel space
	return {
		x: guessU * width,
		y: guessV * height,
	};
}
