import * as THREE from 'three';

const VERTEX_SHADER_HIGHP = /* glsl */ `#version 300 es
  precision highp float;

  in vec3 aPosition;
  in vec3 aScale;
  in vec4 aRot;
  in vec3 aColor;
  in float aOpacity;

  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform vec2 uViewport;
  uniform float uFocalX;
  uniform float uFocalY;
  uniform float uNear;
  uniform float uSigmaScale;
  uniform float uMinPixelRadius;

  out vec4 vColor;
  out vec2 vCenter;
  out vec2 vCovA;
  out vec2 vCovB;

  const vec2 QUAD[4] = vec2[4](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0,  1.0)
  );

  void main() {
    vec4 mv = uModelView * vec4(aPosition, 1.0);
    vec4 clip = uProjection * mv;

    float z = max(abs(mv.z), uNear * 0.01);

    vec2 ndc = clip.xy / clip.w;
    vec2 screenCenter = (ndc * 0.5 + 0.5) * uViewport;
    vCenter = screenCenter;

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

    float w00 = r00 * s0sq * r00 + r01 * s1sq * r01 + r02 * s2sq * r02;
    float w01 = r00 * s0sq * r10 + r01 * s1sq * r11 + r02 * s2sq * r12;
    float w02 = r00 * s0sq * r20 + r01 * s1sq * r21 + r02 * s2sq * r22;
    float w11 = r10 * s0sq * r10 + r11 * s1sq * r11 + r12 * s2sq * r12;
    float w12 = r10 * s0sq * r20 + r11 * s1sq * r21 + r12 * s2sq * r22;
    float w22 = r20 * s0sq * r20 + r21 * s1sq * r21 + r22 * s2sq * r22;

    float fx = uFocalX, fy = uFocalY;
    float iz = 1.0 / z;
    float j00 = fx * iz;
    float j11 = fy * iz;
    float j02 = -fx * mv.x * iz * iz;
    float j12 = -fy * mv.y * iz * iz;

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

    float radius = uSigmaScale * sqrt(max(eigMax, minEig));

    if (radius < uMinPixelRadius) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vColor = vec4(0.0);
      vCenter = vec2(0.0);
      vCovA = vec2(0.0);
      vCovB = vec2(0.0);
      return;
    }

    vec2 corner = QUAD[gl_VertexID];
    vec2 ndcOffset = corner * radius / (uViewport * 0.5);
    gl_Position = vec4(clip.xy + ndcOffset * clip.w, clip.zw);

    vCovA = vec2(s00, s01);
    vCovB = vec2(s01, s11);

    float alpha = clamp(aOpacity, 0.0, 1.0);
    vColor = vec4(aColor * alpha, alpha);
  }
`;

const VERTEX_SHADER_MEDIANP = /* glsl */ `#version 300 es
  precision mediump float;

  in vec3 aPosition;
  in vec3 aScale;
  in vec4 aRot;
  in vec3 aColor;
  in float aOpacity;

  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform vec2 uViewport;
  uniform float uFocalX;
  uniform float uFocalY;
  uniform float uNear;
  uniform float uSigmaScale;
  uniform float uMinPixelRadius;

  out vec4 vColor;
  out vec2 vCenter;
  out vec2 vCovA;
  out vec2 vCovB;

  const vec2 QUAD[4] = vec2[4](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0,  1.0)
  );

  void main() {
    vec4 mv = uModelView * vec4(aPosition, 1.0);
    vec4 clip = uProjection * mv;

    float z = max(abs(mv.z), uNear * 0.01);

    vec2 ndc = clip.xy / clip.w;
    vec2 screenCenter = (ndc * 0.5 + 0.5) * uViewport;
    vCenter = screenCenter;

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

    float w00 = r00 * s0sq * r00 + r01 * s1sq * r01 + r02 * s2sq * r02;
    float w01 = r00 * s0sq * r10 + r01 * s1sq * r11 + r02 * s2sq * r12;
    float w02 = r00 * s0sq * r20 + r01 * s1sq * r21 + r02 * s2sq * r22;
    float w11 = r10 * s0sq * r10 + r11 * s1sq * r11 + r12 * s2sq * r12;
    float w12 = r10 * s0sq * r20 + r11 * s1sq * r21 + r12 * s2sq * r22;
    float w22 = r20 * s0sq * r20 + r21 * s1sq * r21 + r22 * s2sq * r22;

    float fx = uFocalX, fy = uFocalY;
    float iz = 1.0 / z;
    float j00 = fx * iz;
    float j11 = fy * iz;
    float j02 = -fx * mv.x * iz * iz;
    float j12 = -fy * mv.y * iz * iz;

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

    float radius = uSigmaScale * sqrt(max(eigMax, minEig));

    if (radius < uMinPixelRadius) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vColor = vec4(0.0);
      vCenter = vec2(0.0);
      vCovA = vec2(0.0);
      vCovB = vec2(0.0);
      return;
    }

    vec2 corner = QUAD[gl_VertexID];
    vec2 ndcOffset = corner * radius / (uViewport * 0.5);
    gl_Position = vec4(clip.xy + ndcOffset * clip.w, clip.zw);

    vCovA = vec2(s00, s01);
    vCovB = vec2(s01, s11);

    float alpha = clamp(aOpacity, 0.0, 1.0);
    vColor = vec4(aColor * alpha, alpha);
  }
`;

const FRAGMENT_SHADER_HIGHP = /* glsl */ `#version 300 es
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

    float d2 = (c * dx.x * dx.x - 2.0 * b * dx.x * dx.y + a * dx.y * dx.y) / det;

    float G = exp(-0.5 * d2);

    float alpha = G * vColor.a;
    if (alpha < 1.0 / 255.0) discard;

    fragColor = vec4(vColor.rgb * G, alpha);
  }
`;

const FRAGMENT_SHADER_MEDIANP = /* glsl */ `#version 300 es
  precision mediump float;

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
    if (det < 1e-6) discard;

    vec2 dx = gl_FragCoord.xy - vCenter;

    float d2 = (c * dx.x * dx.x - 2.0 * b * dx.x * dx.y + a * dx.y * dx.y) / det;

    float G = exp(-0.5 * d2);

    float alpha = G * vColor.a;
    if (alpha < 1.0 / 255.0) discard;

    fragColor = vec4(vColor.rgb * G, alpha);
  }
`;

interface QuadBuffers {
  vao: WebGLVertexArrayObject | null;
  posVBO: WebGLBuffer | null;
  sclVBO: WebGLBuffer | null;
  rotVBO: WebGLBuffer | null;
  colVBO: WebGLBuffer | null;
  opVBO: WebGLBuffer | null;
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
    uSigmaScale: WebGLUniformLocation | null;
    uMinPixelRadius: WebGLUniformLocation | null;
  };
}

export class InstancedQuadRenderer {
  private gl: WebGL2RenderingContext;
  private program: QuadProgram | null = null;
  private buffers: QuadBuffers | null = null;
  private capacity = 0;
  private disposed = false;
  private sigmaScale = 3.0;
  private minPixelRadius = 1.5;
  private shaderPrecision: 'mediump' | 'highp' = 'highp';

  ready = false;

  constructor(renderer: THREE.WebGLRenderer, options?: { sigmaScale?: number; shaderPrecision?: 'mediump' | 'highp' }) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    if (options?.sigmaScale) this.sigmaScale = options.sigmaScale;
    if (options?.shaderPrecision) this.shaderPrecision = options.shaderPrecision;
    this.init();
  }

  setSigmaScale(value: number): void {
    this.sigmaScale = value;
  }

  setShaderPrecision(precision: 'mediump' | 'highp'): void {
    if (precision === this.shaderPrecision) return;
    this.shaderPrecision = precision;
    if (this.program) {
      this.gl.deleteProgram(this.program.program);
      this.program = null;
    }
    this.compileAndLink();
  }

  private init(): void {
    const gl = this.gl;

    if (!(gl instanceof WebGL2RenderingContext)) {
      console.warn('[InstancedQuadRenderer] WebGL 2.0 required');
      return;
    }

    this.compileAndLink();

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

  private compileAndLink(): void {
    const gl = this.gl;
    const useMediump = this.shaderPrecision === 'mediump';
    const vsSource = useMediump ? VERTEX_SHADER_MEDIANP : VERTEX_SHADER_HIGHP;
    const fsSource = useMediump ? FRAGMENT_SHADER_MEDIANP : FRAGMENT_SHADER_HIGHP;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);

    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      console.error('[InstancedQuadRenderer] Program link error:', log);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = {
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
        uSigmaScale: gl.getUniformLocation(program, 'uSigmaScale'),
        uMinPixelRadius: gl.getUniformLocation(program, 'uMinPixelRadius'),
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

  upload(
    positions: Float32Array,
    scales: Float32Array,
    rots: Float32Array,
    colors: Float32Array,
    opacities: Float32Array,
  ): void {
    if (!this.ready || !this.buffers || !this.program) return;
    const gl = this.gl;
    const N = opacities.length;
    this.capacity = N;

    this.destroyBuffers();

    const b = this.buffers;

    gl.bindVertexArray(b.vao);

    b.posVBO = this.createStaticVBO(positions, 3);
    this.setupInstancedAttrib(b.posVBO, this.program.attribs.aPosition, 3);

    b.sclVBO = this.createStaticVBO(scales, 3);
    this.setupInstancedAttrib(b.sclVBO, this.program.attribs.aScale, 3);

    b.rotVBO = this.createStaticVBO(rots, 4);
    this.setupInstancedAttrib(b.rotVBO, this.program.attribs.aRot, 4);

    b.colVBO = this.createStaticVBO(colors, 3);
    this.setupInstancedAttrib(b.colVBO, this.program.attribs.aColor, 3);

    b.opVBO = this.createStaticVBO(opacities, 1);
    this.setupInstancedAttrib(b.opVBO, this.program.attribs.aOpacity, 1);

    const initialIndices = new Uint32Array(N);
    for (let i = 0; i < N; i++) initialIndices[i] = i;
    b.indexVBO = this.createDynamicVBO(initialIndices);
    this.setupInstancedAttrib(b.indexVBO, this.program.attribs.aSplatIndex, 1, gl.INT);

    gl.bindVertexArray(null);
  }

  private createStaticVBO(data: Float32Array | Uint32Array, _components: number): WebGLBuffer {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('Failed to create VBO');
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return vbo;
  }

  private createDynamicVBO(data: Uint32Array): WebGLBuffer {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('Failed to create dynamic VBO');
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return vbo;
  }

  private setupInstancedAttrib(vbo: WebGLBuffer | null, location: number, components: number, type?: number): void {
    if (location < 0 || !vbo) return;
    const gl = this.gl;
    const attribType = type ?? gl.FLOAT;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(location);
    if (attribType === gl.INT) {
      gl.vertexAttribIPointer(location, components, attribType, 0, 0);
    } else {
      gl.vertexAttribPointer(location, components, attribType, false, 0, 0);
    }
    gl.vertexAttribDivisor(location, 1);
  }

  updateSortIndices(sortedIndices: Uint32Array): void {
    if (!this.ready || !this.buffers || !this.buffers.indexVBO) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.indexVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sortedIndices, 0, sortedIndices.length);
  }

  draw(camera: THREE.PerspectiveCamera, canvasWidth: number, canvasHeight: number): void {
    if (!this.ready || !this.program || !this.buffers || this.capacity === 0) return;
    const gl = this.gl;
    const p = this.program;

    gl.useProgram(p.program);
    gl.bindVertexArray(this.buffers.vao);

    const pm = camera.projectionMatrix.elements;
    gl.uniformMatrix4fv(p.uniforms.uProjection, false, pm);

    const mv = camera.matrixWorldInverse.elements;
    gl.uniformMatrix4fv(p.uniforms.uModelView, false, mv);

    gl.uniform2f(p.uniforms.uViewport, canvasWidth, canvasHeight);
    gl.uniform1f(p.uniforms.uFocalX, pm[0] * canvasWidth * 0.5);
    gl.uniform1f(p.uniforms.uFocalY, pm[5] * canvasHeight * 0.5);
    gl.uniform1f(p.uniforms.uNear, camera.near);
    gl.uniform1f(p.uniforms.uSigmaScale, this.sigmaScale);
    gl.uniform1f(p.uniforms.uMinPixelRadius, this.minPixelRadius);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);
    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.capacity);

    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

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