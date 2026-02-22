/**
 * Chroma Color Effect
 * Ported from ShaderTerminal.qml convertWithChroma function
 *
 * Controls the balance between monochrome and colored terminal output.
 * At 0, the terminal is fully monochrome (green phosphor style).
 * At 1, original colors are preserved.
 *
 * Original QML (terminal_dynamic.frag):
 *   vec3 convertWithChroma(vec3 inColor) {
 *   #if CRT_CHROMA == 1
 *       float grey = rgb2grey(inColor);
 *       float denom = max(grey, 0.0001);
 *       vec3 foregroundColor = mix(fontColor.rgb, inColor * fontColor.rgb / denom, chromaColor);
 *       return mix(backgroundColor.rgb, foregroundColor, grey);
 *   #else
 *       return mix(backgroundColor.rgb, fontColor.rgb, rgb2grey(inColor));
 *   #endif
 *   }
 *
 * Key behaviors:
 * - chromaColor=0: pure monochrome mapping from backgroundColor to fontColor via greyscale
 * - chromaColor=1: preserves original color ratios, tinted by fontColor, with backgroundColor
 * - The normalization (inColor / denom) preserves the hue/saturation of the original color
 *   while fontColor controls the overall tint
 * - backgroundColor is used as the "black" level, properly mixed based on brightness
 */

export const chromaColorGLSL = /* glsl */ `
/**
 * Convert RGB to greyscale using luminance weights
 * MUST match QML ShaderLibrary.qml rgb2grey exactly:
 *   dot(v, vec3(0.21, 0.72, 0.04))
 * @param v - Input RGB color
 * @return Greyscale value
 */
float rgb2grey(vec3 v) {
    return dot(v, vec3(0.21, 0.72, 0.04));
}

/**
 * Apply chroma color conversion
 * Matches QML convertWithChroma function exactly.
 *
 * When chromaColor > 0:
 *   1. Compute greyscale of input
 *   2. Normalize input color by dividing by greyscale (preserves hue/saturation ratios)
 *   3. Multiply normalized color by fontColor (tint)
 *   4. Mix between pure fontColor and tinted-original based on chromaColor amount
 *   5. Mix between backgroundColor and foreground based on greyscale brightness
 *
 * When chromaColor == 0:
 *   Simple monochrome: mix backgroundColor to fontColor by greyscale
 *
 * @param inColor - Input color (raw text color with effects applied)
 * @param fontColor - Terminal phosphor color (e.g., green)
 * @param backgroundColor - Terminal background color
 * @param chromaAmount - Color preservation amount (0 = mono, 1 = full color)
 * @return Converted color
 */
vec3 convertWithChroma(vec3 inColor, vec3 fontColor, vec3 backgroundColor, float chromaAmount) {
    float grey = rgb2grey(inColor);
    if (chromaAmount > 0.0) {
        float denom = max(grey, 0.0001);
        vec3 foregroundColor = mix(fontColor, inColor * fontColor / denom, chromaAmount);
        return mix(backgroundColor, foregroundColor, grey);
    } else {
        return mix(backgroundColor, fontColor, grey);
    }
}
`;

export default chromaColorGLSL;
