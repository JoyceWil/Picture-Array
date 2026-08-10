import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const PDF_FONT_FAMILY = 'PictureArrayCJK'
const PDF_FONT_FILE = 'NotoSansSC-VF.ttf'
const CSS_PX_TO_PT = 72 / 96

type Box = {
  x: number
  y: number
  width: number
  height: number
}

type TextPart = {
  content: string
  isMath: boolean
}

type RichTextOptions = {
  align: 'left' | 'center' | 'right'
  bold: boolean
  italic: boolean
  color: string
  fontSize: number
  rotate?: number
}

type PdfExportOptions = {
  node: HTMLElement
  fileName: string
  title?: string
}

const mathAdaptor = liteAdaptor()
RegisterHTMLHandler(mathAdaptor)
const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'newcommand'] }),
  OutputJax: new SVG({ fontCache: 'none' }),
})

let fontBase64Promise: Promise<string> | null = null
let browserFontPromise: Promise<FontFace> | null = null

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K) {
  return document.createElementNS(SVG_NS, tag)
}

function splitMathText(value: string): TextPart[] {
  const parts: TextPart[] = []
  const formulaPattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let cursor = 0

  for (const match of value.matchAll(formulaPattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ content: value.slice(cursor, index), isMath: false })
    parts.push({ content: match[1] ?? match[2] ?? '', isMath: true })
    cursor = index + match[0].length
  }

  if (cursor < value.length) parts.push({ content: value.slice(cursor), isMath: false })
  return parts.length ? parts : [{ content: value, isMath: false }]
}

function safeNumber(value: string | null | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function getRelativeBox(element: Element, rootRect: DOMRect, scaleX: number, scaleY: number): Box {
  const rect = element.getBoundingClientRect()
  return {
    x: (rect.left - rootRect.left) * scaleX,
    y: (rect.top - rootRect.top) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  }
}

function appendRect(
  root: SVGSVGElement,
  box: Box,
  options: { fill?: string; stroke?: string; strokeWidth?: number },
) {
  if (box.width <= 0 || box.height <= 0) return
  const rect = svgElement('rect')
  rect.setAttribute('x', String(box.x))
  rect.setAttribute('y', String(box.y))
  rect.setAttribute('width', String(box.width))
  rect.setAttribute('height', String(box.height))
  rect.setAttribute('fill', options.fill ?? 'none')
  if (options.stroke) rect.setAttribute('stroke', options.stroke)
  if (options.strokeWidth) rect.setAttribute('stroke-width', String(options.strokeWidth))
  root.appendChild(rect)
}

function parseSvgLength(value: string | null, em: number, ex: number) {
  if (!value) return 0
  const amount = safeNumber(value)
  if (value.endsWith('ex')) return amount * ex
  if (value.endsWith('em')) return amount * em
  return amount
}

function measurePlainText(text: string, options: RichTextOptions) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return { width: text.length * options.fontSize * 0.58, ascent: options.fontSize * 0.8, descent: options.fontSize * 0.2 }
  }
  context.font = `${options.italic ? 'italic' : 'normal'} ${options.bold ? 700 : 400} ${options.fontSize}px "${PDF_FONT_FAMILY}"`
  const metrics = context.measureText(text)
  return {
    width: metrics.width,
    ascent: metrics.actualBoundingBoxAscent || options.fontSize * 0.8,
    descent: metrics.actualBoundingBoxDescent || options.fontSize * 0.2,
  }
}

function createMathSvg(source: string, fontSize: number, color: string) {
  try {
    const converted = mathDocument.convert(source, {
      display: false,
      em: fontSize,
      ex: fontSize / 2,
      containerWidth: Math.max(80, fontSize * 40),
    })
    const markup = mathAdaptor.outerHTML(converted)
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const mathSvg = parsed.querySelector('svg')
    if (!mathSvg) return null

    const imported = document.importNode(mathSvg, true) as SVGSVGElement
    const width = parseSvgLength(imported.getAttribute('width'), fontSize, fontSize / 2)
    const height = parseSvgLength(imported.getAttribute('height'), fontSize, fontSize / 2)
    const verticalAlignMatch = imported.getAttribute('style')?.match(/vertical-align:\s*([^;]+)/)
    const verticalAlign = parseSvgLength(verticalAlignMatch?.[1] ?? null, fontSize, fontSize / 2)

    imported.removeAttribute('style')
    imported.removeAttribute('role')
    imported.removeAttribute('focusable')
    imported.setAttribute('overflow', 'visible')
    imported.querySelectorAll('*').forEach((element) => {
      if (element.getAttribute('fill')?.toLowerCase() === 'currentcolor') {
        element.setAttribute('fill', color)
      }
      if (element.getAttribute('stroke')?.toLowerCase() === 'currentcolor') {
        element.setAttribute('stroke', color)
      }
    })

    return {
      element: imported,
      width: width || fontSize,
      height: height || fontSize,
      verticalAlign,
    }
  } catch {
    return null
  }
}

function appendRichText(
  root: SVGSVGElement,
  value: string,
  box: Box,
  options: RichTextOptions,
) {
  const lines = value.split('\n')
  const lineHeight = options.fontSize * 1.25
  const firstCenterY = box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2
  const group = svgElement('g')
  if (options.rotate) {
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    group.setAttribute('transform', `rotate(${options.rotate} ${centerX} ${centerY})`)
  }

  lines.forEach((line, lineIndex) => {
    const fragments = splitMathText(line).map((part) => {
      if (part.isMath) {
        const math = createMathSvg(part.content, options.fontSize, options.color)
        if (math) return { kind: 'math' as const, ...math }
      }
      const measured = measurePlainText(part.content, options)
      return { kind: 'text' as const, text: part.content, ...measured }
    })
    const totalWidth = fragments.reduce((sum, fragment) => sum + fragment.width, 0)
    let cursorX = box.x + box.width / 2 - totalWidth / 2
    if (options.align === 'left' && !options.rotate) cursorX = box.x + Math.min(5, box.width * 0.08)
    if (options.align === 'right' && !options.rotate) cursorX = box.x + box.width - totalWidth - Math.min(5, box.width * 0.08)

    const centerY = firstCenterY + lineIndex * lineHeight
    const referenceMetrics = measurePlainText('国Ag', options)
    const baseline = centerY + (referenceMetrics.ascent - referenceMetrics.descent) / 2

    fragments.forEach((fragment) => {
      if (fragment.kind === 'math') {
        fragment.element.setAttribute('x', String(cursorX))
        fragment.element.setAttribute(
          'y',
          String(baseline - fragment.height - fragment.verticalAlign),
        )
        fragment.element.setAttribute('width', String(fragment.width))
        fragment.element.setAttribute('height', String(fragment.height))
        group.appendChild(fragment.element)
      } else if (fragment.text) {
        const text = svgElement('text')
        text.setAttribute('x', String(cursorX))
        text.setAttribute('y', String(baseline))
        text.setAttribute('fill', options.color)
        text.setAttribute('font-family', PDF_FONT_FAMILY)
        text.setAttribute('font-size', String(options.fontSize))
        text.setAttribute('font-style', options.italic ? 'italic' : 'normal')
        text.setAttribute('font-weight', options.bold ? 'bold' : 'normal')
        text.setAttribute('xml:space', 'preserve')
        text.textContent = fragment.text
        group.appendChild(text)
      }
      cursorX += fragment.width
    })
  })

  root.appendChild(group)
}

function buildExportSvg(node: HTMLElement) {
  const width = node.offsetWidth
  const height = node.offsetHeight
  const rootRect = node.getBoundingClientRect()
  const scaleX = width / rootRect.width
  const scaleY = height / rootRect.height
  const root = svgElement('svg')
  root.setAttribute('xmlns', SVG_NS)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  root.setAttribute('shape-rendering', 'geometricPrecision')
  root.setAttribute('text-rendering', 'geometricPrecision')

  appendRect(root, { x: 0, y: 0, width, height }, { fill: '#ffffff' })

  node.querySelectorAll<HTMLElement>('.grid-cell').forEach((cell) => {
    const box = getRelativeBox(cell, rootRect, scaleX, scaleY)
    appendRect(root, box, { fill: cell.classList.contains('filled') ? '#ffffff' : '#f3f5f8' })
  })

  node.querySelectorAll<SVGSVGElement>('.cropped-image > svg').forEach((sourceSvg) => {
    const box = getRelativeBox(sourceSvg, rootRect, scaleX, scaleY)
    if (box.width <= 0 || box.height <= 0) return
    const clone = sourceSvg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('x', String(box.x))
    clone.setAttribute('y', String(box.y))
    clone.setAttribute('width', String(box.width))
    clone.setAttribute('height', String(box.height))
    clone.setAttribute('overflow', 'hidden')
    clone.removeAttribute('class')
    clone.removeAttribute('role')
    clone.removeAttribute('aria-label')
    clone.removeAttribute('style')
    root.appendChild(clone)
  })

  node.querySelectorAll<HTMLElement>('.grid-cell').forEach((cell) => {
    const box = getRelativeBox(cell, rootRect, scaleX, scaleY)
    appendRect(root, box, { fill: 'none', stroke: '#ccd5e1', strokeWidth: 1 })
  })

  node.querySelectorAll<HTMLElement>('.row-magnifier-inset').forEach((inset) => {
    const box = getRelativeBox(inset, rootRect, scaleX, scaleY)
    const color = inset.dataset.regionColor || (inset.classList.contains('region-0') ? '#e53935' : '#2468e8')
    appendRect(root, box, { fill: 'none', stroke: color, strokeWidth: 2 })
  })

  node.querySelectorAll<HTMLElement>('.row-magnifier-roi').forEach((roi) => {
    const box = getRelativeBox(roi, rootRect, scaleX, scaleY)
    const color = roi.dataset.regionColor || (roi.classList.contains('region-0') ? '#e53935' : '#2468e8')
    appendRect(root, box, { fill: 'none', stroke: color, strokeWidth: 1.5 })
  })

  const appendElementText = (
    element: HTMLElement,
    rotate = 0,
    forcedAlign?: RichTextOptions['align'],
  ) => {
    const value = element.dataset.exportText ?? ''
    if (!value) return
    const style = window.getComputedStyle(element)
    const fontSize = safeNumber(style.fontSize, 10)
    const numericWeight = safeNumber(style.fontWeight, 400)
    appendRichText(root, value, getRelativeBox(element, rootRect, scaleX, scaleY), {
      align: forcedAlign ?? (style.textAlign === 'left' || style.textAlign === 'right' ? style.textAlign : 'center'),
      bold: style.fontWeight === 'bold' || numericWeight >= 600,
      italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
      color: style.color || '#25344c',
      fontSize,
      rotate,
    })
  }

  node.querySelectorAll<HTMLElement>('.column-label-grid button[data-export-text]').forEach((label) => {
    appendElementText(label, 0, 'center')
  })
  node.querySelectorAll<HTMLElement>('.row-label-grid button[data-export-text]').forEach((label) => {
    appendElementText(label, -90, 'center')
  })
  return { root, width, height }
}

async function loadPdfFont() {
  const fontUrl = `${import.meta.env.BASE_URL}fonts/${PDF_FONT_FILE}`

  browserFontPromise ??= (async () => {
    const face = new FontFace(PDF_FONT_FAMILY, `url("${fontUrl}")`, { weight: '100 900' })
    await face.load()
    document.fonts.add(face)
    return face
  })()

  fontBase64Promise ??= (async () => {
    const response = await fetch(fontUrl)
    if (!response.ok) throw new Error(`无法加载 PDF 中文字体（${response.status}）`)
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error ?? new Error('PDF 字体读取失败'))
      reader.readAsDataURL(blob)
    })
  })()

  const [, base64] = await Promise.all([browserFontPromise, fontBase64Promise])
  return base64
}

export async function exportArtboardPdf({ node, fileName, title }: PdfExportOptions) {
  await document.fonts.ready
  const fontBase64 = await loadPdfFont()
  const { root, width, height } = buildExportSvg(node)
  const widthPt = width * CSS_PX_TO_PT
  const heightPt = height * CSS_PX_TO_PT
  const pdf = new jsPDF({
    orientation: widthPt > heightPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [widthPt, heightPt],
    compress: true,
    putOnlyUsedFonts: true,
    precision: 12,
  })

  pdf.addFileToVFS(PDF_FONT_FILE, fontBase64)
  pdf.addFont(PDF_FONT_FILE, PDF_FONT_FAMILY, 'normal', 400, 'Identity-H')
  pdf.addFont(PDF_FONT_FILE, PDF_FONT_FAMILY, 'bold', 700, 'Identity-H')
  pdf.setFont(PDF_FONT_FAMILY, 'normal')
  pdf.setProperties({
    title: title || fileName,
    creator: 'Picture Array',
    subject: 'Scientific figure export',
  })

  await pdf.svg(root, { x: 0, y: 0, width: widthPt, height: heightPt })
  pdf.save(`${fileName}.pdf`)
}
