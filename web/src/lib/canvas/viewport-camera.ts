import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CameraBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type CameraViewportSize = {
    width: number;
    height: number;
};

type FocusViewportOptions = {
    margin?: number;
    minScale?: number;
    maxScale?: number;
    visibleRatio?: number;
};

export const VIEWPORT_CAMERA_DURATION = 400;
export const VIEWPORT_CAMERA_COOLDOWN = 3000;

export function computeNodesBounds(nodes: Pick<CanvasNodeData, "position" | "width" | "height">[]): CameraBounds | null {
    if (!nodes.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((node) => {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.width);
        maxY = Math.max(maxY, node.position.y + node.height);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function computeFocusViewport(bounds: CameraBounds, viewportSize: CameraViewportSize, current: ViewportTransform, options: FocusViewportOptions = {}): ViewportTransform | null {
    if (bounds.width <= 0 || bounds.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0 || current.k <= 0) return null;

    const margin = Math.max(0, options.margin ?? 80);
    const minScale = options.minScale ?? 0.05;
    const maxScale = options.maxScale ?? 5;
    const visibleRatio = options.visibleRatio ?? 0.7;
    const viewBounds = {
        x: -current.x / current.k,
        y: -current.y / current.k,
        width: viewportSize.width / current.k,
        height: viewportSize.height / current.k,
    };
    const intersectionWidth = Math.max(0, Math.min(bounds.x + bounds.width, viewBounds.x + viewBounds.width) - Math.max(bounds.x, viewBounds.x));
    const intersectionHeight = Math.max(0, Math.min(bounds.y + bounds.height, viewBounds.y + viewBounds.height) - Math.max(bounds.y, viewBounds.y));
    if ((intersectionWidth * intersectionHeight) / (bounds.width * bounds.height) >= visibleRatio) return null;

    const availableWidth = Math.max(1, viewportSize.width - margin * 2);
    const availableHeight = Math.max(1, viewportSize.height - margin * 2);
    const fitScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    const scale = clamp(Math.min(current.k, fitScale), minScale, maxScale);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    return {
        x: viewportSize.width / 2 - centerX * scale,
        y: viewportSize.height / 2 - centerY * scale,
        k: scale,
    };
}

export function easeInOutCubic(progress: number) {
    const value = clamp(progress, 0, 1);
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function interpolateViewport(from: ViewportTransform, to: ViewportTransform, progress: number): ViewportTransform {
    return {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        k: from.k + (to.k - from.k) * progress,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}
