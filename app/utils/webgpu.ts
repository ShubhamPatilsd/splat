/**
 * WebGPU utility functions for device initialization and feature detection
 * Provides fallback to WebGL when WebGPU is not available
 */

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

