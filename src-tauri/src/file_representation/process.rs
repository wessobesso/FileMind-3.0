//! Per-type lightweight file representations (images and text/documents only).

use std::path::{Path, PathBuf};
use std::process::Command;

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};

use super::cache::{cache_stem, CacheLayout};

const TARGET_SIZE: u32 = 512;
const JPEG_QUALITY: u8 = 60;
const TEXT_KEEP_RATIO: f64 = 0.6;

pub fn process_image(cache: &CacheLayout, source: &Path) -> Result<PathBuf, String> {
    let img = image::open(source).map_err(|e| format!("Image open failed: {e}"))?;
    let letterboxed = letterbox_to_square(&img, TARGET_SIZE);
    let rgb = DynamicImage::ImageRgba8(letterboxed).into_rgb8();
    let stem = cache_stem(source);
    let out = cache.images.join(format!("{stem}_512.jpg"));
    let file = std::fs::File::create(&out).map_err(|e| format!("Create image cache failed: {e}"))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, JPEG_QUALITY);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    cache.write_meta(&out, &CacheLayout::meta_now(source, "image"))?;
    Ok(out)
}

fn letterbox_to_square(img: &DynamicImage, size: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    let scale = (size as f32 / w as f32).min(size as f32 / h as f32);
    let nw = (w as f32 * scale).round().max(1.0) as u32;
    let nh = (h as f32 * scale).round().max(1.0) as u32;
    let resized = img.resize_exact(nw, nh, FilterType::Lanczos3).to_rgba8();

    let mut canvas = RgbaImage::from_pixel(size, size, Rgba([0, 0, 0, 255]));
    let x = (size - nw) / 2;
    let y = (size - nh) / 2;
    image::imageops::overlay(&mut canvas, &resized, x.into(), y.into());
    canvas
}

pub fn process_text(cache: &CacheLayout, source: &Path) -> Result<PathBuf, String> {
    let raw = extract_plain_text(source)?;
    let keep_len = ((raw.len() as f64) * TEXT_KEEP_RATIO).floor() as usize;
    let truncated: String = raw.chars().take(keep_len).collect();

    let stem = cache_stem(source);
    let out = cache.text.join(format!("{stem}_excerpt.txt"));
    std::fs::write(&out, truncated.as_bytes())
        .map_err(|e| format!("Write text cache failed: {e}"))?;
    cache.write_meta(&out, &CacheLayout::meta_now(source, "text"))?;
    Ok(out)
}

fn extract_plain_text(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" | "md" => std::fs::read_to_string(path)
            .map_err(|e| format!("Read text file failed: {e}")),
        "pdf" => pdf_extract::extract_text(path).map_err(|e| format!("PDF extract failed: {e}")),
        "doc" | "docx" | "rtf" | "pages" => extract_via_textutil(path),
        _ => Err(format!("Unsupported text extension: {ext}")),
    }
}

#[cfg(target_os = "macos")]
fn extract_via_textutil(path: &Path) -> Result<String, String> {
    let output = Command::new("textutil")
        .args(["-convert", "txt", "-stdout", &path.to_string_lossy()])
        .output()
        .map_err(|e| format!("textutil failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "textutil exit {:?}",
            output.status.code()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(not(target_os = "macos"))]
fn extract_via_textutil(path: &Path) -> Result<String, String> {
    let _ = path;
    Err("Office document extraction requires macOS textutil".to_string())
}
