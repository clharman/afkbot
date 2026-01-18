import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

// Common image extensions
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif'
]);

// Regex to match file paths that could be images
// Matches: /absolute/path.png, ./relative/path.jpg, ~/home/path.gif, "quoted/path.png"
const PATH_PATTERN = /(?:["'`]([^"'`\n]+\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?))|(?:^|[\s(])([~./][^\s)"'`\n]*\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?)))/gi;

export interface ExtractedImage {
  originalPath: string;
  resolvedPath: string;
}

/**
 * Extract image paths from text content and verify they exist on disk
 */
export function extractImagePaths(content: string, cwd?: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();

  // Reset regex state
  PATH_PATTERN.lastIndex = 0;

  let match;
  while ((match = PATH_PATTERN.exec(content)) !== null) {
    // Get the captured path (from quoted or unquoted group)
    const originalPath = (match[1] || match[2]).trim();

    if (!originalPath || seen.has(originalPath)) continue;
    seen.add(originalPath);

    // Resolve the path
    let resolvedPath = originalPath;

    // Handle home directory
    if (resolvedPath.startsWith('~/')) {
      resolvedPath = resolve(homedir(), resolvedPath.slice(2));
    }
    // Handle relative paths
    else if (resolvedPath.startsWith('./') || resolvedPath.startsWith('../')) {
      resolvedPath = resolve(cwd || process.cwd(), resolvedPath);
    }
    // Handle absolute paths (already resolved)
    else if (!resolvedPath.startsWith('/')) {
      // Not a recognizable path format, skip
      continue;
    }

    // Verify file exists and is a file (not directory)
    try {
      if (existsSync(resolvedPath)) {
        const stat = statSync(resolvedPath);
        if (stat.isFile()) {
          // Check extension
          const ext = resolvedPath.toLowerCase().slice(resolvedPath.lastIndexOf('.'));
          if (IMAGE_EXTENSIONS.has(ext)) {
            images.push({ originalPath, resolvedPath });
          }
        }
      }
    } catch {
      // File doesn't exist or can't be accessed, skip
    }
  }

  return images;
}
