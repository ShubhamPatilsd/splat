/**
 * WebGPU Particle Renderer
 * Provides GPU-accelerated particle rendering for water, fire, steam, and other effects
 */

import { isWebGPUSupported, initWebGPUDevice } from './webgpu';

export interface Particle {
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  age?: number;
  lifetime?: number;
  intensity?: number;
}

export interface ParticleRenderer {
  render(particles: Particle[]): void;
  dispose(): void;
  isWebGPU: boolean;
}

/**
 * Create a WebGPU particle renderer with automatic fallback to 2D canvas
 */
export async function createParticleRenderer(
  canvas: HTMLCanvasElement,
  effectType: 'water' | 'fire' | 'steam' | 'burnGlow'
): Promise<ParticleRenderer> {
  // Try WebGPU first
  if (isWebGPUSupported()) {
    try {
      const webgpuRenderer = await createWebGPUParticleRenderer(canvas, effectType);
      if (webgpuRenderer) {
        console.log(`✓ Using WebGPU for ${effectType} particles`);
        return webgpuRenderer;
      }
    } catch (error) {
      console.warn(`WebGPU particle renderer failed for ${effectType}, using 2D canvas fallback:`, error);
    }
  }

  // Fallback to 2D canvas
  return createCanvas2DParticleRenderer(canvas, effectType);
}

/**
 * Create WebGPU-based particle renderer
 */
async function createWebGPUParticleRenderer(
  canvas: HTMLCanvasElement,
  effectType: 'water' | 'fire' | 'steam' | 'burnGlow'
): Promise<ParticleRenderer | null> {
  const gpuInfo = await initWebGPUDevice();
  if (!gpuInfo.device || !gpuInfo.adapter) {
    return null;
  }

  const device = gpuInfo.device;
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    return null;
  }

  const format = navigator.gpu!.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    alphaMode: 'premultiplied',
  });

  // Create shader module based on effect type
  const shaderCode = getShaderCode(effectType);
  const shaderModule = device.createShaderModule({
    label: `${effectType} particle shader`,
    code: shaderCode,
  });

  // Create render pipeline
  const pipeline = device.createRenderPipeline({
    label: `${effectType} particle pipeline`,
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 8 * 4, // x, y, radius, color_r, color_g, color_b, opacity, intensity
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
            { shaderLocation: 1, offset: 8, format: 'float32' }, // radius
            { shaderLocation: 2, offset: 12, format: 'float32x3' }, // color
            { shaderLocation: 3, offset: 24, format: 'float32' }, // opacity
            { shaderLocation: 4, offset: 28, format: 'float32' }, // intensity
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  // Create uniform buffer for time and canvas size
  const uniformBufferSize = 16; // time (4 bytes) + canvasWidth (4 bytes) + canvasHeight (4 bytes) + padding (4 bytes)
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Create bind group
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  return {
    render: (particles: Particle[]) => {
      if (particles.length === 0) return;

      // Update uniform buffer
      const time = Date.now() / 1000;
      const uniformData = new Float32Array([
        time,
        canvas.width,
        canvas.height,
        0, // padding
      ]);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      // Create vertex buffer from particles
      const vertexData = new Float32Array(particles.length * 8);
      let offset = 0;
      for (const particle of particles) {
        const color = parseColor(particle.color);
        vertexData[offset++] = particle.x;
        vertexData[offset++] = particle.y;
        vertexData[offset++] = particle.radius;
        vertexData[offset++] = color.r;
        vertexData[offset++] = color.g;
        vertexData[offset++] = color.b;
        vertexData[offset++] = particle.opacity;
        vertexData[offset++] = particle.intensity || 1.0;
      }

      const vertexBuffer = device.createBuffer({
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, vertexData);

      // Create command encoder
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(particles.length * 6, 1); // 6 vertices per particle (quad)
      pass.end();

      device.queue.submit([encoder.finish()]);
      vertexBuffer.destroy();
    },
    dispose: () => {
      uniformBuffer.destroy();
    },
    isWebGPU: true,
  };
}

/**
 * Create 2D canvas fallback particle renderer
 */
function createCanvas2DParticleRenderer(
  canvas: HTMLCanvasElement,
  effectType: 'water' | 'fire' | 'steam' | 'burnGlow'
): ParticleRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D canvas context');
  }

  return {
    render: (particles: Particle[]) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (const particle of particles) {
        const gradient = ctx.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          particle.radius
        );

        // Effect-specific rendering
        switch (effectType) {
          case 'water':
            gradient.addColorStop(0, particle.color);
            gradient.addColorStop(1, particle.color.replace(/[\d.]+\)$/, '0)'));
            break;
          case 'fire':
            const fireGradient = getFireGradient(particle, gradient);
            ctx.fillStyle = fireGradient;
            break;
          case 'steam':
            gradient.addColorStop(0, `rgba(255, 255, 255, ${particle.opacity * 0.8})`);
            gradient.addColorStop(0.4, `rgba(240, 245, 250, ${particle.opacity * 0.6})`);
            gradient.addColorStop(0.7, `rgba(220, 230, 240, ${particle.opacity * 0.3})`);
            gradient.addColorStop(1, 'rgba(200, 215, 230, 0)');
            break;
          case 'burnGlow':
            gradient.addColorStop(0, particle.color);
            gradient.addColorStop(0.6, particle.color.replace(/[\d.]+\)$/, (parseFloat(particle.color.match(/[\d.]+(?=\)$)/)?.[0] || '0.7') * 0.7).toString() + ')'));
            gradient.addColorStop(1, 'rgba(120, 20, 0, 0)');
            break;
        }

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    },
    dispose: () => {
      // No cleanup needed for 2D canvas
    },
    isWebGPU: false,
  };
}

/**
 * Get WebGPU shader code for effect type
 */
function getShaderCode(effectType: 'water' | 'fire' | 'steam' | 'burnGlow'): string {
  const commonShader = `
    struct Uniforms {
      time: f32,
      canvasWidth: f32,
      canvasHeight: f32,
      _padding: f32,
    }

    @group(0) @binding(0) var<uniform> uniforms: Uniforms;

    struct VertexInput {
      @location(0) position: vec2<f32>,
      @location(1) radius: f32,
      @location(2) color: vec3<f32>,
      @location(3) opacity: f32,
      @location(4) intensity: f32,
    }

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
      @location(1) color: vec3<f32>,
      @location(2) opacity: f32,
      @location(3) intensity: f32,
      @location(4) radius: f32,
    }
  `;

  const vertexShader = `
    @vertex
    fn vs_main(input: VertexInput) -> VertexOutput {
      var output: VertexOutput;
      
      // Create quad vertices
      let quadPositions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0)
      );
      
      let quadUVs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
      );
      
      let vertexIndex = i32(input.position.x); // Reuse position.x as vertex index
      let pos = quadPositions[vertexIndex] * input.radius;
      let screenPos = vec2<f32>(
        (input.position.x / uniforms.canvasWidth) * 2.0 - 1.0,
        1.0 - (input.position.y / uniforms.canvasHeight) * 2.0
      );
      
      output.position = vec4<f32>(screenPos + pos / vec2<f32>(uniforms.canvasWidth, uniforms.canvasHeight) * 2.0, 0.0, 1.0);
      output.uv = quadUVs[vertexIndex];
      output.color = input.color;
      output.opacity = input.opacity;
      output.intensity = input.intensity;
      output.radius = input.radius;
      
      return output;
    }
  `;

  let fragmentShader = '';
  switch (effectType) {
    case 'water':
      fragmentShader = `
        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let dist = length(input.uv - vec2<f32>(0.5));
          let alpha = input.opacity * (1.0 - smoothstep(0.3, 1.0, dist * 2.0));
          return vec4<f32>(input.color, alpha);
        }
      `;
      break;
    case 'fire':
      fragmentShader = `
        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let dist = length(input.uv - vec2<f32>(0.5));
          let heat = 1.0 - dist * 2.0;
          let coreHeat = input.intensity * (1.0 - dist * 3.0);
          
          var color = input.color;
          if (coreHeat > 0.6) {
            color = mix(color, vec3<f32>(1.0, 1.0, 0.9), coreHeat - 0.6);
          }
          
          let alpha = input.opacity * smoothstep(1.0, 0.3, dist * 2.0);
          return vec4<f32>(color, alpha);
        }
      `;
      break;
    case 'steam':
      fragmentShader = `
        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let dist = length(input.uv - vec2<f32>(0.5));
          let pulse = 0.9 + sin(uniforms.time * 5.0 + input.position.x * 0.05) * 0.1;
          let alpha = input.opacity * pulse * (1.0 - smoothstep(0.4, 1.0, dist * 2.0));
          let steamColor = mix(vec3<f32>(1.0), vec3<f32>(0.9, 0.95, 0.98), dist);
          return vec4<f32>(steamColor, alpha);
        }
      `;
      break;
    case 'burnGlow':
      fragmentShader = `
        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let dist = length(input.uv - vec2<f32>(0.5));
          let alpha = input.opacity * smoothstep(1.0, 0.2, dist * 2.0);
          return vec4<f32>(input.color, alpha);
        }
      `;
      break;
  }

  return commonShader + vertexShader + fragmentShader;
}

/**
 * Parse color string to RGB
 */
function parseColor(color: string): { r: number; g: number; b: number } {
  // Handle rgba() format
  const rgbaMatch = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (rgbaMatch) {
    return {
      r: parseFloat(rgbaMatch[1]) / 255,
      g: parseFloat(rgbaMatch[2]) / 255,
      b: parseFloat(rgbaMatch[3]) / 255,
    };
  }

  // Handle hex format
  const hexMatch = color.match(/#([0-9a-f]{6})/i);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1].substring(0, 2), 16) / 255,
      g: parseInt(hexMatch[1].substring(2, 4), 16) / 255,
      b: parseInt(hexMatch[1].substring(4, 6), 16) / 255,
    };
  }

  // Default to white
  return { r: 1, g: 1, b: 1 };
}

/**
 * Get fire gradient for 2D canvas fallback
 */
function getFireGradient(particle: Particle, gradient: CanvasGradient): CanvasGradient {
  const normalizedAge = particle.age && particle.lifetime
    ? Math.min(particle.age / particle.lifetime, 1)
    : 0;
  const intensity = particle.intensity || 1;
  const coreHeat = (1 - normalizedAge) * intensity;

  if (coreHeat > 0.6) {
    gradient.addColorStop(0, `rgba(255, 255, 240, ${coreHeat})`);
    gradient.addColorStop(0.3, `rgba(255, 220, 100, ${coreHeat * 0.9})`);
  } else {
    gradient.addColorStop(0, `rgba(255, 200, 50, ${coreHeat + 0.2})`);
    gradient.addColorStop(0.3, `rgba(255, 150, 0, ${coreHeat + 0.1})`);
  }

  const color = parseColor(particle.color);
  gradient.addColorStop(0.6, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, ${particle.opacity})`);
  gradient.addColorStop(1, 'rgba(100, 20, 0, 0)');

  return gradient;
}

