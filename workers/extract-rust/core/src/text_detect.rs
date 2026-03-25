use image::{GrayImage, Luma};
use std::collections::HashMap;

/// Default minimum combined score (0.0–1.0) to consider an image as containing text.
pub const DEFAULT_SCORE_THRESHOLD: f32 = 0.3;
/// Default minimum character-like components to consider "more than a couple words".
pub const DEFAULT_MIN_CHARS: usize = 15;

/// Thresholds for the text detection decision.
#[derive(Clone, Copy)]
pub struct TextThreshold {
    /// Minimum combined score (0.0–1.0)
    pub score: f32,
    /// Minimum estimated character-like components
    pub min_chars: usize,
}

impl Default for TextThreshold {
    fn default() -> Self {
        Self {
            score: DEFAULT_SCORE_THRESHOLD,
            min_chars: DEFAULT_MIN_CHARS,
        }
    }
}

/// Result of text detection on an image.
pub struct TextDetection {
    /// Overall text likelihood score (0.0 - 1.0)
    pub score: f32,
    /// Estimated number of character-like connected components
    pub estimated_chars: usize,
}

impl TextDetection {
    /// Check against default thresholds.
    pub fn has_significant_text(&self) -> bool {
        self.exceeds(&TextThreshold::default())
    }

    /// Check against custom thresholds.
    pub fn exceeds(&self, threshold: &TextThreshold) -> bool {
        self.score > threshold.score && self.estimated_chars > threshold.min_chars
    }
}

/// Detect if image bytes contain significant text using default thresholds.
/// Returns false for undecodable images rather than panicking.
pub fn has_significant_text(img_bytes: &[u8]) -> bool {
    has_significant_text_with(img_bytes, &TextThreshold::default())
}

/// Detect if image bytes contain significant text using custom thresholds.
pub fn has_significant_text_with(img_bytes: &[u8], threshold: &TextThreshold) -> bool {
    let img = match image::load_from_memory(img_bytes) {
        Ok(img) => img.to_luma8(),
        Err(_) => return false,
    };
    detect_text(&img).exceeds(threshold)
}

/// Run full text detection analysis on a grayscale image.
pub fn detect_text(img: &GrayImage) -> TextDetection {
    let (w, h) = img.dimensions();
    let total_pixels = (w * h) as f32;

    // Too small to contain meaningful text
    if total_pixels < 100.0 {
        return TextDetection { score: 0.0, estimated_chars: 0 };
    }

    // --- Signal 1: Edge density ---
    // Text regions are edge-dense (~0.08–0.25). Photos/backgrounds are <0.05.
    let edges = imageproc::edges::canny(img, 30.0, 80.0);
    let edge_count = edges.pixels().filter(|p| p[0] > 0).count() as f32;
    let edge_density = edge_count / total_pixels;

    // --- Signal 2: Connected component analysis ---
    // Adaptive threshold via Otsu instead of fixed 128
    let thresh = imageproc::contrast::otsu_level(img);
    let binary = imageproc::contrast::threshold(img, thresh);
    let labeled = imageproc::region_labelling::connected_components(
        &binary,
        imageproc::region_labelling::Connectivity::Eight,
        Luma([0u8]),
    );

    // Count pixels per component (dynamic HashMap, no overflow risk)
    let mut component_sizes: HashMap<u32, u32> = HashMap::new();
    for p in labeled.pixels() {
        let label = p[0];
        if label > 0 {
            *component_sizes.entry(label).or_insert(0) += 1;
        }
    }

    // Character-sized blobs: 10–2000 pixels covers most font sizes at typical DPIs
    let char_like_count = component_sizes
        .values()
        .filter(|&&size| size >= 10 && size <= 2000)
        .count();

    let component_density = char_like_count as f32 / (total_pixels / 1000.0);

    // --- Signal 3: Horizontal projection variance ---
    // Text creates alternating bands of dense/sparse rows → high variance
    let row_densities: Vec<f32> = (0..h)
        .map(|y| {
            let dark = (0..w).filter(|&x| img.get_pixel(x, y)[0] < thresh).count() as f32;
            dark / w as f32
        })
        .collect();

    let mean = row_densities.iter().sum::<f32>() / h as f32;
    let variance = row_densities.iter().map(|&d| (d - mean).powi(2)).sum::<f32>() / h as f32;

    // --- Combine ---
    let edge_score = (edge_density / 0.12).min(1.0);
    let comp_score = (component_density / 5.0).min(1.0);
    let variance_score = (variance / 0.03).min(1.0);

    let score = 0.4 * edge_score + 0.35 * comp_score + 0.25 * variance_score;

    TextDetection { score, estimated_chars: char_like_count }
}
