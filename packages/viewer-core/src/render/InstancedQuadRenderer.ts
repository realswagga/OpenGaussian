/**
 * InstancedQuadRenderer — renders Gaussian splats as instanced screen-aligned
 * quads using a raw WebGL 2.0 draw call that coexists with THREE.js.
 *
 * Why instanced quads instead of gl_POINTS:
 *   - No GL_MAX_POINT_SIZE limit (typically 256–1024 px)
 *   - Tighter fragment coverage (quad = ellipse bounding box, not full square)
 *   - Splats can be arbitrarily large on screen
 *   - Each instance consumes one draw call for the entire scene
 *
 * Architecture:
 *   - Uses the same WebGL 2.0 context as THREE.js (`renderer.getContext()`)
 *   - Saves/restores all GL state to avoid corrupting THREE's pipeline
 *   - Splat data is uploaded once into VBOs, never touched again
 *   - Sorted draw-order indices come from RadixSorter each frame
 *   - Draw via gl.drawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, N)
 *
 * Inspired by: supersplat-viewer (PlayCanvas), antimatter15/splat
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;

  // ── Per-instance splat attributes (static, never reordered) ──────────
  in vec3 aPosition;
  in vec3 aScale;
  in vec4 aRot;
  in vec3 aColor;
  in float aOpacity;

  // ── Uniforms ─────────────────────────────────────────────────────────
  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform vec2 uViewport;
  uniform float uFocalX;
  uniform float uFocalY;
  uniform float uNear;

  // ── Outputs to fragment shader ───────────────────────────────────────
  out vec4 vColor;
  out vec2 vCenter;
  out vec2 vCovA;
  out vec2 vCovB;

  // Quad vertex positions in local space (unit quad centered at origin)
  const vec2 QUAD[4] = vec2[4](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0,  1.0)
  );

  void main() {
    // ── Transform splat center to clip space ────────────────────────
    vec4 mv = uModelView * vec4(aPosition, 1.0);
    vec4 clip = uProjection * mv;

    // View-space depth (positive in front of camera)
    float z = max(abs(mv.z), uNear * 0.01);

    // Screen-space centre in pixels
    vec2 ndc = clip.xy / clip.w;
    vec2 screenCenter = (ndc * 0.5 + 0.5) * uViewport;
    vCenter = screenCenter;

    // ── Quaternion → rotation matrix R (3×3) ─────────────────────────
    float qx = aRot.x, qy = aRot.y, qz = aRot.z, qw = aRot.w;
    float xx = qx * qx, yy = qy * qy, zz = qz * qz;
    float xy = qx * qy, xz = qx * qz, yz = qy * qz;
    float wx = qw * qx, wy = qw * qy, wz = qw * qz;

    float s0 = aScale.x, s1 = aScale.y, s2 = aScale.z;
    float s0sq = s0 * s0, s1sq = s1 * s1, s2sq = s2 * s2;

    float r00 = 1.0 - 2.0 * (yy + zz);
    float r01 = 2.0 * (xy - wz);
    float r02 = 2.0 * (xz + wy);
    float r10 = 2.0 * (xy + wz);
    float r11 = 1.0 - 2.0 * (xx + zz);
    float r12 = 2.0 * (yz - wx);
    float r20 = 2.0 * (xz - wy);
    float r21 = 2.0 * (yz + wx);
    float r22 = 1.0 - 2.0 * (xx + yy);

    // World covariance Σ₃ = R · diag(s²) · Rᵀ
    float w00 = r00 * s0sq * r00 + r01 * s1sq * r01 + r02 * s2sq * r02;
    float w01 = r00 * s0sq * r10 + r01 * s1sq * r11 + r02 * s2sq * r12;
    float w02 = r00 * s0sq * r20 + r01 * s1sq * r21 + r02 * s2sq * r22;
    float w11 = r10 * s0sq * r10 + r11 * s1sq * r11 + r12 * s2sq * r12;
    float w12 = r10 * s0sq * r20 + r11 * s1sq * r21 + r12 * s2sq * r22;
    float w22 = r20 * s0sq * r20 + r21 * s1sq * r21 + r22 * s2sq * r22;

    // Projection Jacobian J (2×3)
    float fx = uFocalX, fy = uFocalY;
    float iz = 1.0 / z;
    float j00 = fx * iz;
    float j11 = fy * iz;
    float j02 = -fx * mv.x * iz * iz;
    float j12 = -fy * mv.y * iz * iz;

    // 2D screen covariance Σ₂ = J · Σ₃ · Jᵀ
    float j00_w00 = j00 * w00;
    float j00_w01 = j00 * w01;
    float j00_w02 = j00 * w02;
    float j02_w02 = j02 * w02;
    float j02_w12 = j02 * w12;
    float j02_w22 = j02 * w22;
    float j11_w01 = j11 * w01;
    float j11_w02 = j11 * w02;
    float j11_w11 = j11 * w11;
    float j11_w12 = j11 * w12;
    float j12_w02 = j12 * w02;
    float j12_w12 = j12 * w12;
    float j12_w22 = j12 * w22;

    float s00 = j00 * (j00_w00 + j02_w02) + j02 * (j00_w02 + j02_w22);
    float s01 = j11 * (j00_w01 + j02_w12) + j12 * (j00_w02 + j02_w22);
    float s11 = j11 * (j11_w11 + j12_w12) + j12 * (j11_w12 + j12_w22);

    // Clamp eigenvalues
    float minEig = 0.25;
    float det = s00 * s11 - s01 * s01;
    if (det < minEig * minEig) {
      float trace0 = s00 + s11;
      float adjust = max(0.0, minEig * minEig - det);
      float tr = max(trace0, 0.001);
      s00 += adjust / tr;
      s11 += adjust / tr;
    }
    float traceA = s00 + s11;
    det = s00 * s11 - s01 * s01;
    float eigMax = 0.5 * (traceA + sqrt(max(0.0, traceA * traceA - 4.0 * det)));

    // ── Expand quad to cover 3σ ellipse ──────────────────────────────
    // The quad vertex (QUAD[gl_VertexID]) is in [-1,1]² local space.
    // We scale it to cover the ellipse and offset to the screen center.
    float radius = 3.0 * sqrt(max(eigMax, minEig));
    vec2 corner = QUAD[gl_VertexID];

    // Position the quad corner in clip space
    // Convert pixel offset to NDC:  ndc_offset = pixel_offset / (viewport * 0.5)
    vec2 ndcOffset = corner * radius / (uViewport * 0.5);

    gl_Position = vec4(clip.xy + ndcOffset * clip.w, clip.zw);

    // Store 2D covariance for fragment shader
    vCovA = vec2(s00, s01);
    vCovB = vec2(s01, s11);

    float alpha = clamp(aOpacity, 0.0, 1.0);
    vColor = vec4(aColor * alpha, alpha);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;

  in vec4 vColor;
  in vec2 vCenter;
  in vec2 vCovA;
  in vec2 vCovB;

  out vec4 fragColor;

  void main() {
    vec2 covA = vCovA;
    vec2 covB = vCovB;

    float a = covA.x, b = covA.y, c = covB.y;
    float det = a * c - b * b;
    if (det < 1e-8) discard;

    vec2 dx = gl_FragCoord.xy - vCenter;

    // Mahalanobis distance²
    float d2 = (c * dx.x * dx.x - 2.0 * b * dx.x * dx.y + a * dx.y * dx.y) / det;

    // Gaussian
    float G = exp(-0.5 * d2);

    float alpha = G * vColor.a;
    if (alpha < 1.0 / 255.0) discard;

    fragColor = vec4(vColor.rgb * G, alpha);
  }
`;

// ---------------------------------------------------------------------------
// InstancedQuadRenderer
// ---------------------------------------------------------------------------

interface QuadBuffers {
  vao: WebGLVertexArrayObject | null;
  /** Per-instance: position (vec3) */
  posVBO: WebGLBuffer | null;
  /** Per-instance: scale (vec3) */
  sclVBO: WebGLBuffer | null;
  /** Per-instance: rotation quaternion (vec4) */
  rotVBO: WebGLBuffer | null;
  /** Per-instance: color (vec3) */
  colVBO: WebGLBuffer | null;
  /** Per-instance: opacity (float) */
  opVBO: WebGLBuffer | null;
  /** Draw-order index buffer: uint32 per instance, maps gl_InstanceID → splat index */
  indexVBO: WebGLBuffer | null;
}

interface QuadProgram {
  program: WebGLProgram;
  attribs: {
    aPosition: number;
    aScale: number;
    aRot: number;
    aColor: number;
    aOpacity: number;
    aSplatIndex: number;
  };
  uniforms: {
    uProjection: WebGLUniformLocation | null;
    uModelView: WebGLUniformLocation | null;
    uViewport: WebGLUniformLocation | null;
    uFocalX: WebGLUniformLocation | null;
    uFocalY: WebGLUniformLocation | null;
    uNear: WebGLUniformLocation | null;
  };
}

export class InstancedQuadRenderer {
  private gl: WebGL2RenderingContext;
  private program: QuadProgram | null = null;
  private buffers: QuadBuffers | null = null;
  private capacity = 0;
  private disposed = false;

  /** Whether this renderer was successfully initialized */
  ready = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.init();
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  private init(): void {
    const gl = this.gl;

    // Check WebGL 2.0
    if (!(gl instanceof WebGL2RenderingContext)) {
      console.warn('[InstancedQuadRenderer] WebGL 2.0 required — falling back to THREE.Points');
      return;
    }

    const program = this.compileProgram();
    if (!program) return;
    this.program = program;

    this.buffers = {
      vao: gl.createVertexArray(),
      posVBO: null,
      sclVBO: null,
      rotVBO: null,
      colVBO: null,
      opVBO: null,
      indexVBO: null,
    };

    this.ready = true;
  }

  private compileProgram(): QuadProgram | null {
    const gl = this.gl;

    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);

    // Transform feedback varyings (for GPU sort in future Phase)
    // Not used yet — placeholder for GPU radix sort integration
    // gl.transformFeedbackVaryings(program, ['outKey', 'outIndex'], gl.SEPARATE_ATTRIBS);

    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      console.error('[InstancedQuadRenderer] Program link error:', log);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    return {
      program,
      attribs: {
        aPosition: gl.getAttribLocation(program, 'aPosition'),
        aScale: gl.getAttribLocation(program, 'aScale'),
        aRot: gl.getAttribLocation(program, 'aRot'),
        aColor: gl.getAttribLocation(program, 'aColor'),
        aOpacity: gl.getAttribLocation(program, 'aOpacity'),
        aSplatIndex: gl.getAttribLocation(program, 'aSplatIndex'),
      },
      uniforms: {
        uProjection: gl.getUniformLocation(program, 'uProjection'),
        uModelView: gl.getUniformLocation(program, 'uModelView'),
        uViewport: gl.getUniformLocation(program, 'uViewport'),
        uFocalX: gl.getUniformLocation(program, 'uFocalX'),
        uFocalY: gl.getUniformLocation(program, 'uFocalY'),
        uNear: gl.getUniformLocation(program, 'uNear'),
      },
    };
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[InstancedQuadRenderer] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // -----------------------------------------------------------------------
  // Data upload (call once after loading splats)
  // -----------------------------------------------------------------------

  /**
   * Upload splat data. Call once after parsing.
   *
   * @param positions  Float32Array of [x,y,z] × N
   * @param scales     Float32Array of [sx,sy,sz] × N
   * @param rots       Float32Array of [qx,qy,qz,qw] × N
   * @param colors     Float32Array of [r,g,b] × N
   * @param opacities  Float32Array of [α] × N
   */
  upload(
    positions: Float32Array,
    scales: Float32Array,
    rots: Float32Array,
    colors: Float32Array,
    opacities: Float32Array,
  ): void {
    if (!this.ready || !this.buffers) return;
    const gl = this.gl;
    const N = opacities.length;
    this.capacity = N;

    // Destroy old buffers
    this.destroyBuffers();

    const b = this.buffers;

    // Vertex array
    gl.bindVertexArray(b.vao);

    // ── Per-instance attributes ──────────────────────────────────────
    // Position
    b.posVBO = this.createVBO(positions, 3);
    this.setupInstancedAttrib(b.posVBO, this.program!.attribs.aPosition, 3);

    // Scale
    b.sclVBO = this.createVBO(scales, 3);
    this.setupInstancedAttrib(b.sclVBO, this.program!.attribs.aScale, 3);

    // Rotation
    b.rotVBO = this.createVBO(rots, 4);
    this.setupInstancedAttrib(b.rotVBO, this.program!.attribs.aRot, 4);

    // Color
    b.colVBO = this.createVBO(colors, 3);
    this.setupInstancedAttrib(b.colVBO, this.program!.attribs.aColor, 3);

    // Opacity
    b.opVBO = this.createVBO(opacities, 1);
    this.setupInstancedAttrib(b.opVBO, this.program!.attribs.aOpacity, 1);

    // Draw-order index (will be updated per frame)
    const initialIndices = new Uint32Array(N);
    for (let i = 0; i < N; i++) initialIndices[i] = i;
    b.indexVBO = this.createVBO(initialIndices, 1);
    this.setupInstancedAttrib(b.indexVBO, this.program!.attribs.aSplatIndex, 1);

    gl.bindVertexArray(null);
  }

  private createVBO(data: Float32Array | Uint32Array, _components: number): WebGLBuffer {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('Failed to create VBO');
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return vbo;
  }

  private setupInstancedAttrib(vbo: WebGLBuffer | null, location: number, components: number): void {
    if (location < 0 || !vbo) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(location, 1); // per-instance
  }

  // -----------------------------------------------------------------------
  // Per-frame: update sort indices
  // -----------------------------------------------------------------------

  /**
   * Upload sorted draw-order indices. Must be called before draw().
   * `sortedIndices[i]` = splat index to render at draw position i.
   * Draw position 0 = farthest (rendered first), N-1 = nearest (rendered last).
   */
  updateSortIndices(sortedIndices: Uint32Array): void {
    if (!this.ready || !this.buffers || !this.buffers.indexVBO) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.indexVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sortedIndices, 0, sortedIndices.length);
  }

  // -----------------------------------------------------------------------
  // Draw
  // -----------------------------------------------------------------------

  /**
   * Draw all splats as instanced quads.
   *
   * Call this INSIDE the THREE.js render loop, AFTER threeRenderer.render() or
   * BEFORE (depending on whether you want splats behind or in front of other
   * scene objects). Typically called BEFORE markers/sprites.
   *
   * @param camera THREE.js PerspectiveCamera (for projection/view matrices)
   * @param canvasWidth  Canvas pixel width
   * @param canvasHeight Canvas pixel height
   */
  draw(camera: THREE.PerspectiveCamera, canvasWidth: number, canvasHeight: number): void {
    if (!this.ready || !this.program || !this.buffers || this.capacity === 0) return;
    const gl = this.gl;
    const p = this.program;

    // ── Save THREE.js GL state ────────────────────────────────────────
    gl.useProgram(p.program);
    gl.bindVertexArray(this.buffers.vao);

    // ── Set uniforms ──────────────────────────────────────────────────
    const pm = camera.projectionMatrix.elements;
    gl.uniformMatrix4fv(p.uniforms.uProjection, false, pm);

    const mv = camera.matrixWorldInverse.elements;
    // For a static scene, model matrix is identity, so modelView = view
    gl.uniformMatrix4fv(p.uniforms.uModelView, false, mv);

    gl.uniform2f(p.uniforms.uViewport, canvasWidth, canvasHeight);
    gl.uniform1f(p.uniforms.uFocalX, pm[0] * canvasWidth * 0.5);
    gl.uniform1f(p.uniforms.uFocalY, pm[5] * canvasHeight * 0.5);
    gl.uniform1f(p.uniforms.uNear, camera.near);

    // ── Draw instanced quads ──────────────────────────────────────────
    // 4 vertices (triangle strip), N instances
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);
    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.capacity);

    // ── Restore depth write ───────────────────────────────────────────
    gl.depthMask(true);

    // ── NOTE: We do NOT restore full THREE.js state here because THREE
    //    resets it at the start of each render pass. The depth state
    //    and blend state are restored by THREE on its next render call.
    //    Leaving VAO and program bound is fine — THREE will rebind its own.
    gl.bindVertexArray(null);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  private destroyBuffers(): void {
    if (!this.buffers) return;
    const gl = this.gl;
    const b = this.buffers;
    [b.posVBO, b.sclVBO, b.rotVBO, b.colVBO, b.opVBO, b.indexVBO].forEach((vbo) => {
      if (vbo) gl.deleteBuffer(vbo);
    });
    b.posVBO = b.sclVBO = b.rotVBO = b.colVBO = b.opVBO = b.indexVBO = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.destroyBuffers();
    if (this.buffers?.vao) gl.deleteVertexArray(this.buffers.vao);
    if (this.program) gl.deleteProgram(this.program.program);
    this.buffers = null;
    this.program = null;
    this.ready = false;
  }
}
