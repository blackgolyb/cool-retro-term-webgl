/**
 * CRT Terminal Settings
 * Configuration options for the CRT terminal renderer
 */
export interface CRTTerminalSettings {
	/**
	 * The container element to render into
	 */
	container: HTMLElement;

	/**
	 * Font color in hex format (default: "#0ccc68" - green)
	 */
	fontColor?: string;

	/**
	 * Background color in hex format (default: "#000000" - black)
	 */
	backgroundColor?: string;

	/**
	 * Screen curvature amount, 0-1 (default: 0.3)
	 */
	screenCurvature?: number;

	/**
	 * RGB shift/chromatic aberration amount, 0-0.01 (default: 0)
	 */
	rgbShift?: number;

	/**
	 * Bloom intensity, 0-1 (default: 0.5538)
	 */
	bloom?: number;

	/**
	 * Brightness level, 0-1 (default: 0.5)
	 */
	brightness?: number;

	/**
	 * Ambient light glow, 0-1 (default: 0.2)
	 */
	ambientLight?: number;

	/**
	 * Chroma color amount (0 = monochrome, 1 = full color) (default: 0)
	 */
	chromaColor?: number;

	/**
	 * Saturation color amount (0 = pure font color, 1 = font color mixed 50% toward white)
	 * Controls how much the font color is desaturated/whitened.
	 * This affects both the derived fontColor and backgroundColor sent to the shader.
	 * Matches QML ApplicationSettings.qml saturatedColor computation.
	 * (default: 0)
	 */
	saturationColor?: number;

	/**
	 * Contrast level (0-1) controlling the mixing between font and background colors.
	 * Higher contrast means fontColor stays closer to the saturated font color
	 * and backgroundColor stays closer to pure black.
	 * Matches QML ApplicationSettings.qml contrast property.
	 * (default: 0.85)
	 */
	contrast?: number;

	/**
	 * Flickering intensity, 0-1 (default: 0.1)
	 */
	flickering?: number;

	/**
	 * Horizontal sync distortion, 0-1 (default: 0.08)
	 */
	horizontalSync?: number;

	/**
	 * Jitter amount (random pixel displacement), 0-1 (default: 0.1997)
	 */
	jitter?: number;

	/**
	 * Static noise intensity, 0-1 (default: 0.1198)
	 */
	staticNoise?: number;

	/**
	 * Glowing line (scanning beam) intensity, 0-1 (default: 0.2)
	 */
	glowingLine?: number;

	/**
	 * Burn-in (phosphor persistence) intensity, 0-1 (default: 0.2517)
	 */
	burnIn?: number;

	/**
	 * Rasterization mode: 0=none, 1=scanline, 2=pixel, 3=subpixel (default: 1)
	 */
	rasterizationMode?: number;

	/**
	 * Rasterization intensity, 0-1 (default: 0.5)
	 */
	rasterizationIntensity?: number;

	/**
	 * Frame (bezel) size around the screen, 0-1 (default: 0.2).
	 * This is the raw _frameSize value from QML; the shader receives
	 * _frameSize * 0.05 * normalizedWindowScale.
	 */
	frameSize?: number;

	/**
	 * Screen corner radius, 0-1 (default: 0.2).
	 * This is the raw _screenRadius value from QML; the shader receives
	 * lint(4.0, 120.0, _screenRadius) in pixel units.
	 */
	screenRadius?: number;

	/**
	 * Frame shininess / reflectivity, 0-1 (default: 0.2).
	 * This is the raw _frameShininess value from QML; the shader receives
	 * _frameShininess * 0.5.
	 */
	frameShininess?: number;

	/**
	 * Frame color in hex format (default: "#ffffff").
	 * Combined with font/background colors and ambient light to produce
	 * the final bezel tint (matching QML TerminalFrame.qml).
	 */
	frameColor?: string;
}

/**
 * Default settings for CRT terminal
 */
export const DEFAULT_SETTINGS: Required<
	Omit<CRTTerminalSettings, "container">
> = {
	fontColor: "#0ccc68",
	backgroundColor: "#000000",
	screenCurvature: 0.3,
	rgbShift: 0,
	bloom: 0.5538,
	brightness: 0.5,
	ambientLight: 0.2,
	chromaColor: 0,
	saturationColor: 0,
	contrast: 0.85,
	flickering: 0.1,
	horizontalSync: 0.08,
	jitter: 0.1997,
	staticNoise: 0.1198,
	glowingLine: 0.2,
	burnIn: 0.2517,
	rasterizationMode: 1,
	rasterizationIntensity: 0.5,
	frameSize: 0.2,
	screenRadius: 0.2,
	frameShininess: 0.2,
	frameColor: "#ffffff",
};
