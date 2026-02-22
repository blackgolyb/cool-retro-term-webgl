/**
 * Terminal Frame Shader
 * Faithfully ported from cool-retro-term terminal_frame.frag (GLSL 440)
 *
 * This shader renders the CRT frame bezel with:
 * - SDF rounded rectangle for smooth edges
 * - Seam shading (N/S/E/W directional lighting on the bezel)
 * - Glass reflection effect on the screen area
 * - Dithering noise on the frame
 * - Proper alpha blending (frame is opaque-ish, screen area is semi-transparent glass)
 *
 * Matches the original QML TerminalFrame.qml + terminal_frame.frag exactly.
 */

export const terminalFrameVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const terminalFrameFragmentShader = /* glsl */ `
precision highp float;

uniform float screenCurvature;
uniform vec4 frameColor;
uniform float frameSize;
uniform float screenRadius;
uniform vec2 viewportSize;
uniform float ambientLight;
uniform float frameShininess;

varying vec2 vUv;

float min2(vec2 v) { return min(v.x, v.y); }
float prod2(vec2 v) { return v.x * v.y; }
float rand2(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }

/**
 * Distort coordinates to simulate CRT screen curvature on the frame.
 * This is the INVERSE of the barrel distortion used for text —
 * it expands outward so the frame edge follows the curved screen.
 *
 * The frameSize padding maps UV [0,1] to a larger range so that
 * the "screen" occupies [0,1] within the padded space and the
 * bezel frame extends around it.
 *
 * Matches QML terminal_frame.frag distortCoordinates() exactly.
 */
vec2 distortCoordinates(vec2 coords) {
    vec2 paddedCoords = coords * (vec2(1.0) + frameSize * 2.0) - frameSize;
    vec2 cc = (paddedCoords - vec2(0.5));
    float dist = dot(cc, cc) * screenCurvature;
    return (paddedCoords + cc * (1.0 + dist) * dist);
}

/**
 * Signed Distance Field for a rounded rectangle.
 * Returns negative values inside, positive outside, zero on the edge.
 * All computation is in pixel space for crisp anti-aliasing.
 *
 * Matches QML terminal_frame.frag roundedRectSdfPixels() exactly.
 *
 * @param p          - Current fragment position in UV [0,1]
 * @param topLeft    - Top-left corner of the rect in UV
 * @param bottomRight - Bottom-right corner of the rect in UV
 * @param radiusPixels - Corner radius in pixels
 */
float roundedRectSdfPixels(vec2 p, vec2 topLeft, vec2 bottomRight, float radiusPixels) {
    vec2 sizePixels = (bottomRight - topLeft) * viewportSize;
    vec2 centerPixels = (topLeft + bottomRight) * 0.5 * viewportSize;
    vec2 localPixels = p * viewportSize - centerPixels;
    vec2 halfSize = sizePixels * 0.5 - vec2(radiusPixels);
    vec2 d = abs(localPixels) - halfSize;
    return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - radiusPixels;
}

void main() {
    vec2 staticCoords = vUv;
    vec2 coords = distortCoordinates(staticCoords);

    float screenRadiusPixels = screenRadius;
    float edgeSoftPixels = 1.0;

    // Seam width — determines the softness of directional shading transitions
    float seamWidth = max(screenRadiusPixels, 0.5) / min2(viewportSize);

    // Seam shading: N/S/E/W directional factors for bezel lighting
    // Each factor represents how much a fragment is on that side of the bezel.
    // East side
    float e = min(
        smoothstep(-seamWidth, seamWidth, coords.x - coords.y),
        smoothstep(-seamWidth, seamWidth, coords.x - (1.0 - coords.y))
    );
    // South side
    float s = min(
        smoothstep(-seamWidth, seamWidth, coords.y - coords.x),
        smoothstep(-seamWidth, seamWidth, coords.x - (1.0 - coords.y))
    );
    // West side
    float w = min(
        smoothstep(-seamWidth, seamWidth, coords.y - coords.x),
        smoothstep(-seamWidth, seamWidth, (1.0 - coords.x) - coords.y)
    );
    // North side
    float n = min(
        smoothstep(-seamWidth, seamWidth, coords.x - coords.y),
        smoothstep(-seamWidth, seamWidth, (1.0 - coords.x) - coords.y)
    );

    // SDF distance to the screen rectangle edge (in pixels)
    float distPixels = roundedRectSdfPixels(coords, vec2(0.0), vec2(1.0), screenRadiusPixels);

    // Frame shadow from seam shading — simulates directional light on the bezel
    // East and West get 0.66, North gets 0.33 (darker), South gets 1.0 (brightest)
    float frameShadow = (e * 0.66 + w * 0.66 + n * 0.33 + s);
    // Only apply shadow outside the screen area (fade in from edge)
    frameShadow *= smoothstep(0.0, edgeSoftPixels * 5.0, distPixels);

    // Frame base alpha (reduced by shininess — shinier frame is more transparent)
    float frameAlpha = 1.0 - frameShininess * 0.4;

    // inScreen: 1.0 inside the screen area, 0.0 outside, smooth transition at edge
    float inScreen = smoothstep(0.0, edgeSoftPixels, -distPixels);

    // Alpha: frame area gets frameAlpha, screen area gets ambient-dependent glass alpha
    float alpha = mix(frameAlpha, mix(0.0, 0.3, ambientLight), inScreen);

    // Glass reflection effect — visible on the screen area
    // Creates a subtle highlight that's brightest in the center
    float glass = clamp(
        ambientLight * pow(prod2(coords * (1.0 - coords.yx)) * 25.0, 0.5) * inScreen,
        0.0,
        1.0
    );

    // Frame tint: frame color modulated by seam shadow
    vec3 frameTint = frameColor.rgb * frameShadow;

    // Dithering noise to reduce banding on the frame
    float noise = rand2(staticCoords * viewportSize) - 0.5;
    frameTint = clamp(frameTint + vec3(noise * 0.04), 0.0, 1.0);

    // Final color: frame tint on the bezel, glass highlight on the screen
    vec3 color = mix(frameTint, vec3(glass), inScreen);

    gl_FragColor = vec4(color, alpha);
}
`;
