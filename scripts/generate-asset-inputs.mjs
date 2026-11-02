import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, cp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

// The launcher icon is the official T3 Code app mark (assets/prod/logo.svg
// upstream, served at https://app.t3.codes). The foreground file holds the T3
// glyph alone on transparency, already inset for Android's adaptive safe zone.
const APP_ICON_SVG = resolve('public/t3code-app-icon.svg')
const GLYPH_SVG = resolve('public/t3code-app-icon-foreground.svg')

const ASSETS_DIR = resolve('assets')
const PUBLIC_DIR = resolve('public')
const ICONS_DIR = resolve('icons')
const PUBLIC_ICONS_DIR = resolve('public/icons')
const DOCS_DIR = resolve('docs')
const ANDROID_RES = resolve('android/app/src/main/res')

// T3 Code's icon is a black rounded square, so the icon background is black.
const ICON_BG = '#000000'
const SPLASH_BG = '#000000'

const ICON_SIZE = 1024
const SPLASH_SIZE = 2732
const APPLE_TOUCH_SIZE = 180
const SPLASH_LOGO_MAX = 1000

const FOREGROUND_DENSITIES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

async function renderSvgOnBg(svgPath, targetSize, bgColor) {
  return sharp(readFileSync(svgPath))
    .resize(targetSize, targetSize, {
      fit: 'contain',
      background: bgColor,
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: bgColor })
    .png({ compressionLevel: 6 })
    .toBuffer()
}

async function renderSvgTransparent(svgPath, targetSize) {
  return sharp(readFileSync(svgPath))
    .resize(targetSize, targetSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 6 })
    .toBuffer()
}

async function renderSvgCenteredOnBg(svgPath, canvasSize, logoMaxDimension, bgColor) {
  const svg = readFileSync(svgPath)
  const meta = await sharp(svg).metadata()
  const svgWidth = meta.width ?? 1024
  const svgHeight = meta.height ?? 1024
  const logoScale = logoMaxDimension / Math.max(svgWidth, svgHeight)
  const logoWidth = Math.round(svgWidth * logoScale)
  const logoHeight = Math.round(svgHeight * logoScale)

  const logoBuffer = await sharp(svg)
    .resize(logoWidth, logoHeight, {
      fit: 'fill',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: bgColor,
    },
  })
    .composite([{
      input: logoBuffer,
      top: Math.round((canvasSize - logoHeight) / 2),
      left: Math.round((canvasSize - logoWidth) / 2),
    }])
    .png({ compressionLevel: 6 })
    .toBuffer()
}

async function createSolidImage(width, height, color) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  })
    .png({ compressionLevel: 6 })
    .toBuffer()
}

async function moveIconsToPublic() {
  if (existsSync(ICONS_DIR)) {
    rmSync(PUBLIC_ICONS_DIR, { recursive: true, force: true })
    ensureDir(PUBLIC_ICONS_DIR)
    await cp(ICONS_DIR, PUBLIC_ICONS_DIR, { recursive: true })
    rmSync(ICONS_DIR, { recursive: true, force: true })
    console.log('Moved icons/ → public/icons/')
  }
}

function fixManifestPaths() {
  const manifestPath = resolve(PUBLIC_DIR, 'manifest.webmanifest')
  if (!existsSync(manifestPath)) return

  let manifest = readFileSync(manifestPath, 'utf-8')
  const fixed = manifest.replace(/"\.\.\/icons\//g, '"./icons/')
  if (fixed !== manifest) {
    writeFile(manifestPath, fixed)
    console.log('Fixed ../icons/ → ./icons/ in manifest.webmanifest')
  }
}

async function generateCapacitorAssetsInputs() {
  ensureDir(ASSETS_DIR)

  console.log('assets/icon-only.png')
  await writeFile(
    resolve(ASSETS_DIR, 'icon-only.png'),
    await renderSvgOnBg(GLYPH_SVG, ICON_SIZE, ICON_BG),
  )

  console.log('assets/icon-background.png')
  await writeFile(
    resolve(ASSETS_DIR, 'icon-background.png'),
    await createSolidImage(ICON_SIZE, ICON_SIZE, ICON_BG),
  )

  console.log('assets/icon-foreground.png')
  await writeFile(
    resolve(ASSETS_DIR, 'icon-foreground.png'),
    await renderSvgTransparent(GLYPH_SVG, ICON_SIZE),
  )

  console.log('assets/splash.png')
  await writeFile(
    resolve(ASSETS_DIR, 'splash.png'),
    await renderSvgCenteredOnBg(GLYPH_SVG, SPLASH_SIZE, SPLASH_LOGO_MAX, SPLASH_BG),
  )

  console.log('assets/splash-dark.png')
  await writeFile(
    resolve(ASSETS_DIR, 'splash-dark.png'),
    await renderSvgCenteredOnBg(GLYPH_SVG, SPLASH_SIZE, SPLASH_LOGO_MAX, SPLASH_BG),
  )
}

async function generateStandaloneAssets() {
  console.log('public/apple-touch-icon.png')
  await writeFile(
    resolve(PUBLIC_DIR, 'apple-touch-icon.png'),
    await renderSvgOnBg(GLYPH_SVG, APPLE_TOUCH_SIZE, ICON_BG),
  )
}

async function copyDocsAssets() {
  ensureDir(DOCS_DIR)
  const files = [
    'favicon.svg',
    't3code-app-icon.svg',
    't3code-mobile-client-logo-dark.svg',
    't3code-mobile-client-logo-light.svg',
  ]
  for (const file of files) {
    const src = resolve(PUBLIC_DIR, file)
    if (!existsSync(src)) continue
    const dest = resolve(DOCS_DIR, file)
    await copyFile(src, dest)
    console.log(`docs/${file}`)
  }
}

async function generateAdaptiveIconForegrounds() {
  for (const [density, size] of Object.entries(FOREGROUND_DENSITIES)) {
    const dir = resolve(ANDROID_RES, `mipmap-${density}`)
    if (!existsSync(dir)) continue

    console.log(`mipmap-${density}/ic_launcher_foreground.png`)
    await writeFile(
      resolve(dir, 'ic_launcher_foreground.png'),
      await renderSvgTransparent(GLYPH_SVG, size),
    )
  }
}

/**
 * capacitor-assets wraps both adaptive layers in a 16.7% inset, which leaves a
 * transparent (white) ring around our full-bleed background. Rewrite the layer
 * list so the background fills the whole 108dp canvas.
 */
function fixAdaptiveIconXml() {
  const dir = resolve(ANDROID_RES, 'mipmap-anydpi-v26')
  if (!existsSync(dir)) return

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const file = resolve(dir, name)
    if (!existsSync(file)) continue
    writeFileSync(file, xml)
    console.log(`mipmap-anydpi-v26/${name}`)
  }
}

async function main() {
  const isPostCap = process.argv.includes('--post-cap')

  if (isPostCap) {
    await moveIconsToPublic()
    fixManifestPaths()
    await generateAdaptiveIconForegrounds()
    fixAdaptiveIconXml()
    return
  }

  await generateCapacitorAssetsInputs()
  await generateStandaloneAssets()
  await copyDocsAssets()

  await moveIconsToPublic()
  fixManifestPaths()

  console.log('✓ Done')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exitCode = 1
})