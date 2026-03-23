use std::io::{Cursor, Read};
use zip::ZipArchive;

const IMAGE_EXTENSIONS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp",
];

fn is_image_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    IMAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

/// Extract content-embedded images from a DOCX file (word/media/*).
pub fn extract_docx_images(bytes: &[u8]) -> Vec<Vec<u8>> {
    extract_from_zip(bytes, "word/media/")
}

/// Extract content-embedded images from a PPTX file (ppt/media/*).
pub fn extract_pptx_images(bytes: &[u8]) -> Vec<Vec<u8>> {
    extract_from_zip(bytes, "ppt/media/")
}

fn extract_from_zip(bytes: &[u8], media_prefix: &str) -> Vec<Vec<u8>> {
    let mut archive = match ZipArchive::new(Cursor::new(bytes)) {
        Ok(a) => a,
        Err(_) => return Vec::new(),
    };

    let mut images = Vec::new();

    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let name = file.name().to_string();

        if name.starts_with(media_prefix) && is_image_file(&name) {
            let mut buf = Vec::new();
            if file.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                images.push(buf);
            }
        }
    }

    images
}
