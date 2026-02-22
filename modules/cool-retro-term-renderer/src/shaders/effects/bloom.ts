/**
 * Bloom Effect
 * Ported from ShaderTerminal.qml staticShader (lines 487-492)
 *
 * Adds a glow effect from bright areas of the screen.
 *
 * In the original QML, this uses a SEPARATE pre-blurred texture (bloomSource)
 * created by Qt's FastBlur with radius 32. For the web version, we simulate
 * this with a multi-tap blur approximation.
 *
 * Original QML static shader (terminal_static.frag):
 *   vec4 bloomFullColor = texture(bloomSource, txt_coords);
 *   vec3 bloomColor = bloomFullColor.rgb;
 *   float bloomAlpha = bloomFullColor.a;
 *
 *   vec3 bloomOnScreen = bloomColor * isScreen;
 *   finalColor += clamp(bloomOnScreen * bloom * bloomAlpha, 0.0, 0.5);
 *   float bloomScale = 1.0 + max(bloom, 0.0);
 *   finalColor /= bloomScale;
 *
 * IMPORTANT: In the original, bloom is applied as RAW color in the static pass
 * (no chroma conversion). The bloomScale division normalizes the range so it
 * fits in the [0,1] render target. The dynamic pass then multiplies by
 * bloomScale to restore the full range before applying chroma conversion.
 * This way bloom goes through chroma conversion together with the rest of the
 * color in the dynamic pass.
 *
 * Note: bloom uniform is set as appSettings.bloom * 2.5 in QML
 */

export const bloomGLSL = /* glsl */ `
/**
 * Multi-tap blur to approximate the pre-blurred bloom source texture
 * The original QML uses Qt's FastBlur with radius 32.
 * We use a larger kernel to better approximate this.
 *
 * @param tex - Source texture sampler
 * @param coords - Texture coordinates (already curved)
 * @param resolution - Screen resolution for proper texel sizing
 * @return Blurred color approximating bloomSource
 */
vec4 getBloomSourceSample(sampler2D tex, vec2 coords, vec2 resolution) {
    vec2 texelSize = 1.0 / resolution;
    vec4 bloom = vec4(0.0);
    float totalWeight = 0.0;

    // 13-tap blur pattern to approximate FastBlur radius 32
    // Using larger offsets with gaussian-like weights
    const float offsets[5] = float[5](0.0, 4.0, 8.0, 12.0, 16.0);
    const float weights[5] = float[5](0.20, 0.18, 0.14, 0.10, 0.06);

    for (int i = 0; i < 5; i++) {
        float offset = offsets[i];
        float weight = weights[i];

        // Sample in cross pattern
        vec2 offsetX = vec2(offset * texelSize.x, 0.0);
        vec2 offsetY = vec2(0.0, offset * texelSize.y);

        // Clamp coordinates to prevent sampling outside bounds
        vec2 sampleCoordsPX = clamp(coords + offsetX, 0.0, 1.0);
        vec2 sampleCoordsNX = clamp(coords - offsetX, 0.0, 1.0);
        vec2 sampleCoordsPY = clamp(coords + offsetY, 0.0, 1.0);
        vec2 sampleCoordsNY = clamp(coords - offsetY, 0.0, 1.0);

        if (i == 0) {
            bloom += texture2D(tex, coords) * weight;
            totalWeight += weight;
        } else {
            bloom += texture2D(tex, sampleCoordsPX) * weight;
            bloom += texture2D(tex, sampleCoordsNX) * weight;
            bloom += texture2D(tex, sampleCoordsPY) * weight;
            bloom += texture2D(tex, sampleCoordsNY) * weight;
            totalWeight += weight * 4.0;
        }
    }

    if (totalWeight > 0.0) {
        bloom /= totalWeight;
    }

    // Return with alpha = 1.0 (in QML the bloomSource has alpha from the original)
    return vec4(bloom.rgb, 1.0);
}

/**
 * Apply bloom effect to the final color (RAW, no chroma conversion)
 * Matches original QML static shader exactly:
 *   vec3 bloomOnScreen = bloomColor * isScreen;
 *   finalColor += clamp(bloomOnScreen * bloom * bloomAlpha, 0.0, 0.5);
 *   float bloomScale = 1.0 + max(bloom, 0.0);
 *   finalColor /= bloomScale;
 *
 * The bloom is added as raw color. The bloomScale division normalizes
 * the color range to fit in the render target. The dynamic pass will
 * multiply by bloomScale to restore the full range before chroma conversion.
 *
 * @param baseColor - The base terminal color (raw, no chroma applied)
 * @param tex - Source texture for bloom sampling
 * @param coords - Texture coordinates (already curved via txt_coords)
 * @param resolution - Screen resolution
 * @param bloom - Bloom intensity (already multiplied by 2.5 in uniform)
 * @return Color with bloom applied and divided by bloomScale
 */
vec3 applyBloom(vec3 baseColor, sampler2D tex, vec2 coords, vec2 resolution, float bloom) {
    if (bloom <= 0.0) {
        return baseColor;
    }

    // Get blurred color (simulating bloomSource)
    vec4 bloomFullColor = getBloomSourceSample(tex, coords, resolution);
    vec3 bloomColor = bloomFullColor.rgb;
    float bloomAlpha = bloomFullColor.a;

    // Add raw bloom contribution with clamping (exactly as QML static shader)
    vec3 bloomContribution = clamp(bloomColor * bloom * bloomAlpha, 0.0, 0.5);
    vec3 result = baseColor + bloomContribution;

    // Normalize by bloomScale to fit in render target range
    float bloomScale = 1.0 + max(bloom, 0.0);
    result /= bloomScale;

    return result;
}
`;

export default bloomGLSL;
