/**
 * WebGPU utility functions for device initialization and feature detection
 * Provides fallback to WebGL when WebGPU is not available
 */

// WebGPU type declarations (for browsers that support it)
declare global {
  interface Navigator {
    gpu?: GPU;
  }

  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }

  interface GPURequestAdapterOptions {
    powerPreference?: 'low-power' | 'high-performance';
    forceFallbackAdapter?: boolean;
  }

  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    requestAdapterInfo(): Promise<GPUAdapterInfo>;
  }

  interface GPUDeviceDescriptor {
    requiredFeatures?: GPUFeatureName[];
    requiredLimits?: Record<string, number>;
  }

  interface GPUDevice {
    addEventListener(type: 'uncapturederror', listener: (event: GPUUncapturedErrorEvent) => void): void;
  }

  interface GPUUncapturedErrorEvent {
    error: GPUError;
  }

  interface GPUError {
    readonly message: string;
  }

  interface GPUAdapterInfo {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  }

  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
  }

  interface GPUCanvasConfiguration {
    device: GPUDevice;
    format: GPUTextureFormat;
    usage?: number;
    alphaMode?: 'opaque' | 'premultiplied';
  }

  type GPUTextureFormat = string;
  type GPUFeatureName = string;

  enum GPUTextureUsage {
    RENDER_ATTACHMENT = 0x10,
  }
}

export interface WebGPUDeviceInfo {
  device: GPUDevice | null;
  adapter: GPUAdapter | null;
  isSupported: boolean;
  error?: string;
}

/**
 * Check if WebGPU is supported in the current browser
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Initialize WebGPU device with proper error handling
 */
export async function initWebGPUDevice(): Promise<WebGPUDeviceInfo> {
  const result: WebGPUDeviceInfo = {
    device: null,
    adapter: null,
    isSupported: false,
  };

  if (!isWebGPUSupported()) {
    result.error = 'WebGPU is not supported in this browser';
    return result;
  }

  try {
    const gpu = navigator.gpu;
    if (!gpu) {
      result.error = 'navigator.gpu is not available';
      return result;
    }

    // Request adapter
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
      forceFallbackAdapter: false,
    });

    if (!adapter) {
      result.error = 'Failed to get WebGPU adapter';
      return result;
    }

    result.adapter = adapter;
    result.isSupported = true;

    // Request device
    const device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    });

    result.device = device;

    // Handle device lost
    device.addEventListener('uncapturederror', (event: GPUUncapturedErrorEvent) => {
      console.error('WebGPU uncaptured error:', event.error);
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error initializing WebGPU';
    console.warn('WebGPU initialization failed:', result.error);
    return result;
  }
}

/**
 * Get WebGPU adapter info for debugging
 */
export async function getWebGPUAdapterInfo(): Promise<GPUAdapterInfo | null> {
  if (!isWebGPUSupported()) {
    return null;
  }

  try {
    const gpu = navigator.gpu;
    if (!gpu) {
      return null;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return null;
    }

    const info = await adapter.requestAdapterInfo();
    return info;
  } catch (error) {
    console.warn('Failed to get WebGPU adapter info:', error);
    return null;
  }
}

/**
 * Check if WebGPU canvas context is available
 */
export function isWebGPUCanvasContextSupported(): boolean {
  if (typeof HTMLCanvasElement === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgpu');
    return context !== null;
  } catch {
    return false;
  }
}

/**
 * Create a WebGPU canvas context with proper configuration
 */
export function createWebGPUCanvasContext(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): GPUCanvasContext | null {
  try {
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    const gpu = navigator.gpu;
    if (!context || !gpu) {
      return null;
    }

    const format = gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: 'premultiplied',
    });

    return context;
  } catch (error) {
    console.error('Failed to create WebGPU canvas context:', error);
    return null;
  }
}

