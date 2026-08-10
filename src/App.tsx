import {
  AlignHorizontalSpaceAround,
  Bold,
  Check,
  ChevronDown,
  Columns3,
  Crop,
  Download,
  FileImage,
  FileDown,
  FolderOpen,
  Grid2X2,
  ImagePlus,
  ImageIcon,
  Info,
  Italic,
  Layers3,
  LoaderCircle,
  Minus,
  MousePointer2,
  Move,
  Plus,
  Redo2,
  RotateCcw,
  Rows3,
  Save,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toPng } from 'html-to-image'
import katex from 'katex'
import {
  deleteWorkspaceTemplate,
  getWorkspaceTemplate,
  listWorkspaceTemplates,
  saveWorkspaceTemplate,
  type WorkspaceTemplateSummary,
} from './workspaceDb'
import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type CropSettings = {
  x: number
  y: number
  width: number
  height: number
}

type CropCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

type Asset = {
  id: string
  name: string
  src: string
  width: number
  height: number
  size: number
  crop: CropSettings
  origin?: 'demo' | 'imported' | 'processed'
  sourceAssetId?: string
}

type GridCell = {
  assetId?: string
  label?: string
}

type MagnifierRegion = {
  id: string
  x: number
  y: number
  size: number
}

type RowMagnifier = {
  id: string
  row: number
  regions: MagnifierRegion[]
}

type RatioPreset = {
  label: string
  value: string
}

type CropTemplatePreset = {
  id: string
  name: string
  crop: CropSettings
  ratioPreset: string
  createdAt: number
}

type ProjectSnapshot = {
  projectName: string
  rows: number
  columns: number
  gap: number
  zoom: number
  assets: Asset[]
  cells: GridCell[]
  template: CropSettings
  columnLabels?: string[]
  rowLabels?: string[]
  showLabels?: boolean
  fitDrawing?: boolean
  canvasWidth?: number
  canvasMinHeight?: number
  canvasPadding?: number
  linkLabelPositions?: boolean
  rowLabelOffset?: number
  columnLabelOffset?: number
  sourceImageScale?: number
  labelFontSize?: number
  labelBold?: boolean
  labelItalic?: boolean
  rowMagnifiers?: RowMagnifier[]
  magnifiersEnabled?: boolean
  magnifierBorderColors?: [string, string]
}

type ExportFormat = 'pdf' | 'png'
type ExportScale = 2 | 3

const DEFAULT_CROP: CropSettings = { x: 0, y: 0, width: 100, height: 100 }
const PRODUCT_NAME = 'Picture Array'
const PRODUCT_FILE_NAME = 'Picture_Array'
const DRAFT_KEY = 'picture-array:draft:v1'
const LEGACY_DRAFT_KEY = 'paper-grid-studio:draft:v1'
const CROP_TEMPLATE_LIBRARY_KEY = 'picture-array:crop-templates:v1'
const LEGACY_CROP_TEMPLATE_LIBRARY_KEY = 'paper-grid-studio:crop-templates:v1'
const VECTOR_PRINT_STYLE_ID = 'picture-array-vector-print-page'
const ASSET_DRAG_TYPE = 'application/x-picture-array-asset'
const DEFAULT_MAGNIFIER_COUNT = 2
const MAX_MAGNIFIER_COUNT = 4
const DEFAULT_SOURCE_IMAGE_SCALE = 100
const DEFAULT_LABEL_FONT_SIZE = 9
const DEFAULT_MAGNIFIER_BORDER_COLORS: [string, string] = ['#e53935', '#2468e8']
const LEGACY_MAGNIFIER_ROI_WIDTH_FACTOR = 3 / 4
const CROP_CORNERS: CropCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

function readStoredValue(key: string, legacyKey: string) {
  const current = window.localStorage.getItem(key)
  if (current !== null) return current
  const legacy = window.localStorage.getItem(legacyKey)
  if (legacy !== null) {
    try {
      window.localStorage.setItem(key, legacy)
    } catch {
      // The legacy value remains readable even when storage is full.
    }
  }
  return legacy
}
const ratioPresets: RatioPreset[] = [
  { label: '自由', value: 'free' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '16:9', value: '16:9' },
]

function formatBytes(bytes: number) {
  if (!bytes) return '示例素材'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatStorageBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatWorkspaceDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createUniqueId(prefix: string) {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `${prefix}-${globalThis.crypto.randomUUID()}`
    }
  } catch {
    // Some embedded or non-secure browser contexts expose crypto without randomUUID support.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitizedFilePart(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

function reserveProcessedAssetName(
  sourceName: string,
  templateName: string,
  reservedNames: Set<string>,
) {
  const sourceStem = sanitizedFilePart(sourceName.replace(/\.[^.]+$/, '')) || '素材'
  const templateStem = sanitizedFilePart(templateName) || '裁剪'
  const baseName = `${sourceStem}_${templateStem}`
  let candidate = `${baseName}.png`
  let sequence = 2

  while (reservedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${baseName}_${sequence}.png`
    sequence += 1
  }

  reservedNames.add(candidate.toLocaleLowerCase())
  return candidate
}

function loadImageSource(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败'))
    image.src = src
  })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('裁剪结果编码失败'))
    reader.readAsDataURL(blob)
  })
}

async function createProcessedAsset(
  asset: Asset,
  crop: CropSettings,
  name: string,
): Promise<Asset> {
  const sourceImage = await loadImageSource(asset.src)
  const sourceWidth = sourceImage.naturalWidth || asset.width
  const sourceHeight = sourceImage.naturalHeight || asset.height
  const sourceX = clamp((crop.x / 100) * sourceWidth, 0, sourceWidth - 1)
  const sourceY = clamp((crop.y / 100) * sourceHeight, 0, sourceHeight - 1)
  const cropWidth = clamp((crop.width / 100) * sourceWidth, 1, sourceWidth - sourceX)
  const cropHeight = clamp((crop.height / 100) * sourceHeight, 1, sourceHeight - sourceY)
  const outputWidth = Math.max(1, Math.round(cropWidth))
  const outputHeight = Math.max(1, Math.round(cropHeight))
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const context = canvas.getContext('2d')

  if (!context) throw new Error('当前浏览器无法创建图片画布')
  context.drawImage(
    sourceImage,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  )

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('裁剪结果生成失败'))),
      'image/png',
    )
  })

  return {
    id: createUniqueId(`processed-${asset.id}`),
    name,
    src: await blobToDataUrl(blob),
    width: outputWidth,
    height: outputHeight,
    size: blob.size,
    crop: { ...DEFAULT_CROP },
    origin: 'processed',
    sourceAssetId: asset.id,
  }
}

function defaultMagnifierRegion(index: number): MagnifierRegion {
  const positions = [
    { x: 10, y: 10 },
    { x: 72, y: 66 },
    { x: 72, y: 10 },
    { x: 10, y: 66 },
  ]
  const position = positions[index % positions.length]
  return {
    id: createUniqueId(`roi-${index + 1}`),
    x: position.x,
    y: position.y,
    size: 24,
  }
}

function normalizeHexColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback
}

function normalizeMagnifierBorderColors(value: unknown): [string, string] {
  const colors = Array.isArray(value) ? value : []
  return [
    normalizeHexColor(colors[0], DEFAULT_MAGNIFIER_BORDER_COLORS[0]),
    normalizeHexColor(colors[1], DEFAULT_MAGNIFIER_BORDER_COLORS[1]),
  ]
}

function colorWithAlpha(color: string, alpha: number) {
  const value = Number.parseInt(color.slice(1), 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function createMagnifierColorVariables(colors: [string, string]): CSSProperties {
  return {
    '--magnifier-color-0': colors[0],
    '--magnifier-tint-0': colorWithAlpha(colors[0], 0.1),
    '--magnifier-tint-strong-0': colorWithAlpha(colors[0], 0.2),
    '--magnifier-color-1': colors[1],
    '--magnifier-tint-1': colorWithAlpha(colors[1], 0.1),
    '--magnifier-tint-strong-1': colorWithAlpha(colors[1], 0.2),
  } as CSSProperties
}

function createRowMagnifier(row: number, count = DEFAULT_MAGNIFIER_COUNT): RowMagnifier {
  return {
    id: createUniqueId(`magnifier-row-${row}`),
    row,
    regions: Array.from({ length: count }, (_, index) => defaultMagnifierRegion(index)),
  }
}

function normalizeMagnifierRegion(value: unknown, index: number): MagnifierRegion {
  if (!value || typeof value !== 'object') return defaultMagnifierRegion(index)
  const raw = value as Record<string, unknown>
  const rawHeight = Number(raw.size ?? raw.height)
  const rawWidth = Number(raw.width)
  const legacySquareSize = Number.isFinite(rawWidth)
    ? rawWidth / LEGACY_MAGNIFIER_ROI_WIDTH_FACTOR
    : 24
  const size = clamp(
    Number.isFinite(rawHeight) ? rawHeight : legacySquareSize,
    12,
    48,
  )
  const width = size * LEGACY_MAGNIFIER_ROI_WIDTH_FACTOR
  const rawX = Number(raw.x)
  const rawY = Number(raw.y)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createUniqueId(`roi-${index + 1}`),
    x: clamp(Number.isFinite(rawX) ? rawX : defaultMagnifierRegion(index).x, 0, 100 - width),
    y: clamp(Number.isFinite(rawY) ? rawY : defaultMagnifierRegion(index).y, 0, 100 - size),
    size,
  }
}

function normalizeRowMagnifiers(value: unknown, rowCount: number): RowMagnifier[] {
  if (!Array.isArray(value)) return []

  const normalized: RowMagnifier[] = []
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    const raw = entry as Record<string, unknown>
    const rawRow = Number(raw.row)
    const row = clamp(Number.isFinite(rawRow) ? Math.round(rawRow) : 0, 0, Math.max(0, rowCount - 1))
    if (normalized.some((item) => item.row === row)) return

    let regionEntries: unknown[]
    if (Array.isArray(raw.regions) && raw.regions.length) {
      regionEntries = raw.regions.slice(0, MAX_MAGNIFIER_COUNT)
    } else if ('x' in raw || 'y' in raw || 'width' in raw || 'height' in raw) {
      regionEntries = [raw, defaultMagnifierRegion(1)]
    } else {
      regionEntries = Array.from(
        { length: DEFAULT_MAGNIFIER_COUNT },
        (_, regionIndex) => defaultMagnifierRegion(regionIndex),
      )
    }

    normalized.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : createUniqueId(`magnifier-${index}`),
      row,
      regions: regionEntries.map(normalizeMagnifierRegion),
    })
  })
  return normalized
}

function cropWithinCrop(
  base: CropSettings,
  region: MagnifierRegion,
  roiWidthFactor: number,
): CropSettings {
  const width = region.size * roiWidthFactor
  return {
    x: base.x + (base.width * region.x) / 100,
    y: base.y + (base.height * region.y) / 100,
    width: (base.width * width) / 100,
    height: (base.height * region.size) / 100,
  }
}

function croppedAspectRatio(asset: Asset) {
  const croppedWidth = asset.width * (asset.crop.width / 100)
  const croppedHeight = asset.height * (asset.crop.height / 100)
  if (!Number.isFinite(croppedWidth) || !Number.isFinite(croppedHeight) || croppedHeight <= 0) {
    return 1
  }
  return Math.max(0.01, croppedWidth / croppedHeight)
}

function defaultColumnLabel(index: number) {
  if (index === 0) return '输入图像'
  return `方法 ${String.fromCharCode(64 + ((index - 1) % 26) + 1)}`
}

function defaultRowLabel(index: number) {
  return `样本 ${String(index + 1).padStart(2, '0')}`
}

type MathTextPart = {
  content: string
  displayMode: boolean
  isMath: boolean
}

function splitMathText(value: string): MathTextPart[] {
  const parts: MathTextPart[] = []
  const formulaPattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let cursor = 0

  for (const match of value.matchAll(formulaPattern)) {
    const matchIndex = match.index ?? 0
    if (matchIndex > cursor) {
      parts.push({ content: value.slice(cursor, matchIndex), displayMode: false, isMath: false })
    }

    parts.push({
      content: match[1] ?? match[2] ?? '',
      displayMode: match[1] !== undefined,
      isMath: true,
    })
    cursor = matchIndex + match[0].length
  }

  if (cursor < value.length) {
    parts.push({ content: value.slice(cursor), displayMode: false, isMath: false })
  }

  return parts.length ? parts : [{ content: value, displayMode: false, isMath: false }]
}

function MathText({ value }: { value: string }) {
  return (
    <span className="math-text">
      {splitMathText(value).map((part, index) =>
        part.isMath ? (
          <span
            key={`${index}-${part.content}`}
            className={`latex-fragment ${part.displayMode ? 'display' : 'inline'}`}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.content, {
                displayMode: part.displayMode,
                output: 'htmlAndMathml',
                throwOnError: false,
                strict: 'ignore',
                trust: false,
              }),
            }}
          />
        ) : (
          <span key={`${index}-${part.content}`}>{part.content}</span>
        ),
      )}
    </span>
  )
}

function demoImage(colors: string[], variant: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 560
  canvas.height = 360
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const glow = ctx.createRadialGradient(
    180 + variant * 42,
    140 + variant * 18,
    8,
    250,
    190,
    260,
  )
  glow.addColorStop(0, 'rgba(255,255,255,.82)')
  glow.addColorStop(0.18, 'rgba(255,218,120,.42)')
  glow.addColorStop(0.62, 'rgba(24,52,92,.08)')
  glow.addColorStop(1, 'rgba(8,16,34,.45)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.globalAlpha = 0.36
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 2
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath()
    for (let x = -20; x <= canvas.width + 20; x += 8) {
      const y =
        56 +
        i * 40 +
        Math.sin((x + variant * 50) / (34 + i * 3)) * (12 + i * 1.4) +
        variant * 3
      if (x === -20) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  return canvas.toDataURL('image/jpeg', 0.88)
}

function createDemoAssets(): Asset[] {
  return [
    {
      id: 'demo-original',
      name: 'Input_01.png',
      src: demoImage(['#0a1736', '#1e80a5', '#e9c46a', '#cc5233'], 1),
      width: 560,
      height: 360,
      size: 0,
      crop: { ...DEFAULT_CROP },
      origin: 'demo',
    },
    {
      id: 'demo-method-a',
      name: 'Method_A.png',
      src: demoImage(['#08152f', '#2856a5', '#3ed2c5', '#f4e3a1'], 2),
      width: 560,
      height: 360,
      size: 0,
      crop: { ...DEFAULT_CROP },
      origin: 'demo',
    },
    {
      id: 'demo-method-b',
      name: 'Method_B.png',
      src: demoImage(['#140f2d', '#713e87', '#d36e78', '#f5ca80'], 3),
      width: 560,
      height: 360,
      size: 0,
      crop: { ...DEFAULT_CROP },
      origin: 'demo',
    },
    {
      id: 'demo-ground-truth',
      name: 'Ground_Truth.png',
      src: demoImage(['#071c2e', '#117782', '#6ac58d', '#f2d26f'], 4),
      width: 560,
      height: 360,
      size: 0,
      crop: { ...DEFAULT_CROP },
      origin: 'demo',
    },
  ]
}

function CroppedImage({
  asset,
  className = '',
  alt,
}: {
  asset: Asset
  className?: string
  alt?: string
}) {
  const crop = asset.crop
  const cropX = (crop.x / 100) * asset.width
  const cropY = (crop.y / 100) * asset.height
  const cropWidth = (crop.width / 100) * asset.width
  const cropHeight = (crop.height / 100) * asset.height
  const accessibleName = alt ?? asset.name
  return (
    <div
      className={`cropped-image ${className}`}
      style={{ aspectRatio: `${croppedAspectRatio(asset)} / 1` }}
    >
      <svg
        viewBox={`${cropX} ${cropY} ${cropWidth} ${cropHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={accessibleName}
      >
        <image
          href={asset.src}
          x="0"
          y="0"
          width={asset.width}
          height={asset.height}
          preserveAspectRatio="xMidYMid meet"
        />
      </svg>
    </div>
  )
}

function NumberField({
  label,
  value,
  suffix,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (value: number) => void
  min?: number
  max?: number
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  )
}

export default function App() {
  const initialDraft = useMemo<ProjectSnapshot | null>(() => {
    try {
      const raw = readStoredValue(DRAFT_KEY, LEGACY_DRAFT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as ProjectSnapshot
      if (!parsed.assets || !parsed.cells || !parsed.rows || !parsed.columns) return null
      return parsed
    } catch {
      return null
    }
  }, [])

  const [assets, setAssets] = useState<Asset[]>(() => initialDraft?.assets ?? createDemoAssets())
  const [selectedAssetId, setSelectedAssetId] = useState(
    initialDraft?.assets[0]?.id ?? 'demo-original',
  )
  const [rows, setRows] = useState(initialDraft?.rows ?? 2)
  const [columns, setColumns] = useState(initialDraft?.columns ?? 3)
  const [gap, setGap] = useState(initialDraft?.gap ?? 12)
  const [zoom, setZoom] = useState(initialDraft?.zoom ?? 84)
  const [cells, setCells] = useState<GridCell[]>(() => initialDraft?.cells ?? [
      { assetId: 'demo-original' },
      { assetId: 'demo-method-a' },
      { assetId: 'demo-method-b' },
      { assetId: 'demo-original' },
      { assetId: 'demo-method-a' },
      { assetId: 'demo-ground-truth' },
    ])
  const [columnLabels, setColumnLabels] = useState<string[]>(
    () => initialDraft?.columnLabels ?? Array.from({ length: initialDraft?.columns ?? 3 }, (_, index) => defaultColumnLabel(index)),
  )
  const [rowLabels, setRowLabels] = useState<string[]>(
    () => initialDraft?.rowLabels ?? Array.from({ length: initialDraft?.rows ?? 2 }, (_, index) => defaultRowLabel(index)),
  )
  const [showLabels, setShowLabels] = useState(initialDraft?.showLabels ?? true)
  const [fitDrawing, setFitDrawing] = useState(initialDraft?.fitDrawing ?? true)
  const [canvasWidth, setCanvasWidth] = useState(initialDraft?.canvasWidth ?? 760)
  const [canvasMinHeight, setCanvasMinHeight] = useState(initialDraft?.canvasMinHeight ?? 400)
  const [canvasPadding, setCanvasPadding] = useState(initialDraft?.canvasPadding ?? 28)
  const [linkLabelPositions, setLinkLabelPositions] = useState(
    initialDraft?.linkLabelPositions ?? true,
  )
  const [rowLabelOffset, setRowLabelOffset] = useState(initialDraft?.rowLabelOffset ?? 3)
  const [columnLabelOffset, setColumnLabelOffset] = useState(
    initialDraft?.columnLabelOffset ?? 3,
  )
  const [sourceImageScale, setSourceImageScale] = useState(
    clamp(Math.round(initialDraft?.sourceImageScale ?? DEFAULT_SOURCE_IMAGE_SCALE), 50, 200),
  )
  const [labelFontSize, setLabelFontSize] = useState(
    clamp(Math.round(initialDraft?.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE), 6, 48),
  )
  const [labelBold, setLabelBold] = useState(initialDraft?.labelBold ?? true)
  const [labelItalic, setLabelItalic] = useState(initialDraft?.labelItalic ?? false)
  const [rowMagnifiers, setRowMagnifiers] = useState<RowMagnifier[]>(
    () => normalizeRowMagnifiers(initialDraft?.rowMagnifiers, initialDraft?.rows ?? 2),
  )
  const [magnifiersEnabled, setMagnifiersEnabled] = useState(
    initialDraft?.magnifiersEnabled ?? Boolean(initialDraft?.rowMagnifiers?.length),
  )
  const [magnifierBorderColors, setMagnifierBorderColors] = useState<[string, string]>(
    () => normalizeMagnifierBorderColors(initialDraft?.magnifierBorderColors),
  )
  const [activeElementPanel, setActiveElementPanel] = useState<
    'none' | 'labels' | 'magnifier' | 'canvas'
  >('none')
  const [selectedMagnifierRegionId, setSelectedMagnifierRegionId] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<number | null>(0)
  const [ratioPreset, setRatioPreset] = useState('free')
  const [template, setTemplate] = useState<CropSettings>(
    initialDraft?.template ?? { ...DEFAULT_CROP },
  )
  const [draftCrop, setDraftCrop] = useState<CropSettings>({ ...DEFAULT_CROP })
  const [cropTemplates, setCropTemplates] = useState<CropTemplatePreset[]>(() => {
    try {
      const raw = readStoredValue(
        CROP_TEMPLATE_LIBRARY_KEY,
        LEGACY_CROP_TEMPLATE_LIBRARY_KEY,
      )
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [selectedCropTemplateId, setSelectedCropTemplateId] = useState('')
  const [cropTemplateName, setCropTemplateName] = useState('')
  const [isProcessingAssets, setIsProcessingAssets] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [toast, setToast] = useState('')
  const [projectName, setProjectName] = useState(
    initialDraft?.projectName ?? '未命名项目',
  )
  const [saveStatus, setSaveStatus] = useState(
    initialDraft ? '已载入本地草稿' : '本地草稿',
  )
  const [editingName, setEditingName] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf')
  const [exportScale, setExportScale] = useState<ExportScale>(3)
  const [isExporting, setIsExporting] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceTemplates, setWorkspaceTemplates] = useState<WorkspaceTemplateSummary[]>([])
  const [workspaceTemplateName, setWorkspaceTemplateName] = useState('')
  const [selectedWorkspaceTemplateId, setSelectedWorkspaceTemplateId] = useState('')
  const [isWorkspaceBusy, setIsWorkspaceBusy] = useState(false)
  const [workspaceStorageText, setWorkspaceStorageText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const artboardRef = useRef<HTMLDivElement>(null)
  const cropPreviewRef = useRef<SVGSVGElement>(null)
  const cropDragRef = useRef<{
    corner: CropCorner
    crop: CropSettings
    offsetX: number
    offsetY: number
  } | null>(null)
  const magnifierDragRef = useRef<{
    row: number
    regionId: string
    mode: 'move' | 'resize'
    startX: number
    startY: number
    originX: number
    originY: number
    originSize: number
  } | null>(null)

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )
  const selectedWorkspaceTemplate = useMemo(
    () => workspaceTemplates.find((item) => item.id === selectedWorkspaceTemplateId) ?? null,
    [selectedWorkspaceTemplateId, workspaceTemplates],
  )
  const layoutAspectRatio = useMemo(() => {
    const firstPlacedAsset = cells
      .map((cell) => assets.find((asset) => asset.id === cell.assetId))
      .find((asset): asset is Asset => Boolean(asset))
    const referenceAsset = firstPlacedAsset ?? assets[0]
    return referenceAsset ? croppedAspectRatio(referenceAsset) : 1
  }, [assets, cells])
  const magnifierColorVariables = useMemo(
    () => createMagnifierColorVariables(magnifierBorderColors),
    [magnifierBorderColors],
  )
  const magnifierRoiWidthFactor = 1 / layoutAspectRatio
  const selectedRowIndex = selectedCell === null ? null : Math.floor(selectedCell / columns)
  const selectedRowMagnifier = useMemo(
    () =>
      magnifiersEnabled
        ? rowMagnifiers.find((item) => item.row === selectedRowIndex) ?? null
        : null,
    [magnifiersEnabled, rowMagnifiers, selectedRowIndex],
  )
  const selectedMagnifierRegion = useMemo(
    () =>
      selectedRowMagnifier?.regions.find((region) => region.id === selectedMagnifierRegionId) ??
      selectedRowMagnifier?.regions[0] ??
      null,
    [selectedRowMagnifier, selectedMagnifierRegionId],
  )

  useEffect(() => {
    if (selectedAsset) {
      setDraftCrop({ ...selectedAsset.crop })
    }
  }, [selectedAssetId])

  useEffect(() => {
    if (!selectedRowMagnifier?.regions.length) {
      setSelectedMagnifierRegionId(null)
      return
    }
    setSelectedMagnifierRegionId((current) =>
      selectedRowMagnifier.regions.some((region) => region.id === current)
        ? current
        : selectedRowMagnifier.regions[0].id,
    )
  }, [selectedRowMagnifier?.id, selectedRowMagnifier?.regions.length])

  useEffect(() => {
    const wanted = rows * columns
    setCells((current) => {
      if (current.length === wanted) return current
      if (current.length > wanted) return current.slice(0, wanted)
      return [...current, ...Array.from({ length: wanted - current.length }, () => ({}))]
    })
    setColumnLabels((current) =>
      Array.from({ length: columns }, (_, index) => current[index] ?? defaultColumnLabel(index)),
    )
    setRowLabels((current) =>
      Array.from({ length: rows }, (_, index) => current[index] ?? defaultRowLabel(index)),
    )
    setSelectedCell((current) => (current !== null && current >= wanted ? wanted - 1 : current))
    setRowMagnifiers((current) => {
      const valid = current.filter((item) => item.row < rows)
      if (!magnifiersEnabled) return valid
      const count = valid[0]?.regions.length ?? DEFAULT_MAGNIFIER_COUNT
      return Array.from(
        { length: rows },
        (_, row) => valid.find((item) => item.row === row) ?? createRowMagnifier(row, count),
      )
    })
  }, [rows, columns, magnifiersEnabled])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    try {
      window.localStorage.setItem(CROP_TEMPLATE_LIBRARY_KEY, JSON.stringify(cropTemplates))
    } catch {
      setToast('裁剪模板保存空间不足')
    }
  }, [cropTemplates])

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) {
      setToast('请选择 PNG、JPG、WEBP 等图片文件')
      return
    }

    const readImageFile = (file: File) =>
      new Promise<Asset | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const image = new Image()
          image.onload = () =>
            resolve({
              id: createUniqueId(`${file.name}-${file.lastModified}`),
              name: file.name,
              src: String(reader.result),
              width: image.naturalWidth,
              height: image.naturalHeight,
              size: file.size,
              crop: { ...template },
              origin: 'imported',
            })
          image.onerror = () => resolve(null)
          image.src = String(reader.result)
        }
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })

    const imported: Array<Asset | null> = Array.from({ length: imageFiles.length }, () => null)
    let nextFileIndex = 0
    const worker = async () => {
      while (nextFileIndex < imageFiles.length) {
        const index = nextFileIndex
        nextFileIndex += 1
        imported[index] = await readImageFile(imageFiles[index])
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(6, imageFiles.length) }, () => worker()),
    )

    const validAssets = imported.filter((asset): asset is Asset => asset !== null)
    if (!validAssets.length) {
      setToast('图片读取失败，请检查文件是否损坏')
      return
    }

    const replaceExamples =
      assets.length > 0 &&
      assets.every((asset) => asset.origin === 'demo' || asset.id.startsWith('demo-'))

    setAssets((current) => (replaceExamples ? validAssets : [...current, ...validAssets]))
    setCells((current) => {
      let importIndex = 0
      return current.map((cell) => {
        const canFill = replaceExamples || !cell.assetId
        const nextAsset = canFill ? validAssets[importIndex] : undefined
        if (canFill && nextAsset) {
          importIndex += 1
          return { ...cell, assetId: nextAsset.id }
        }
        if (replaceExamples) return { ...cell, assetId: undefined }
        return cell
      })
    })
    setSelectedAssetId(validAssets[0].id)

    const failedCount = imageFiles.length - validAssets.length
    const fillMessage = replaceExamples ? '，已替换示例并填入画布' : '，空单元格已自动填充'
    setToast(
      `已导入 ${validAssets.length} 个素材${fillMessage}${failedCount ? `，${failedCount} 个失败` : ''}`,
    )
  }, [assets, template])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void importFiles(event.target.files)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
    if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files)
  }

  const updateDraftCrop = (key: keyof CropSettings, value: number) => {
    setDraftCrop((current) => {
      const next = { ...current, [key]: clamp(Number.isFinite(value) ? value : 0, 0, 100) }
      next.width = clamp(next.width, 1, 100 - next.x)
      next.height = clamp(next.height, 1, 100 - next.y)
      next.x = clamp(next.x, 0, 100 - next.width)
      next.y = clamp(next.y, 0, 100 - next.height)
      return next
    })
  }

  const cropPointFromPointer = (event: ReactPointerEvent<SVGRectElement>) => {
    const svg = cropPreviewRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix || !selectedAsset) return null

    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const imagePoint = point.matrixTransform(matrix.inverse())
    return {
      x: clamp((imagePoint.x / selectedAsset.width) * 100, 0, 100),
      y: clamp((imagePoint.y / selectedAsset.height) * 100, 0, 100),
    }
  }

  const handleCropPointerDown = (
    event: ReactPointerEvent<SVGRectElement>,
    corner: CropCorner,
  ) => {
    const point = cropPointFromPointer(event)
    if (!point) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const cornerX = corner.includes('left') ? draftCrop.x : draftCrop.x + draftCrop.width
    const cornerY = corner.includes('top') ? draftCrop.y : draftCrop.y + draftCrop.height
    cropDragRef.current = {
      corner,
      crop: { ...draftCrop },
      offsetX: point.x - cornerX,
      offsetY: point.y - cornerY,
    }
  }

  const handleCropPointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const drag = cropDragRef.current
    const point = cropPointFromPointer(event)
    if (!drag || !point || !selectedAsset) return

    const movesLeft = drag.corner.includes('left')
    const movesTop = drag.corner.includes('top')
    const anchorX = movesLeft ? drag.crop.x + drag.crop.width : drag.crop.x
    const anchorY = movesTop ? drag.crop.y + drag.crop.height : drag.crop.y
    const pointerX = point.x - drag.offsetX
    const pointerY = point.y - drag.offsetY
    const maxWidth = movesLeft ? anchorX : 100 - anchorX
    const maxHeight = movesTop ? anchorY : 100 - anchorY
    const rawWidth = movesLeft
      ? anchorX - clamp(pointerX, 0, anchorX - 1)
      : clamp(pointerX, anchorX + 1, 100) - anchorX
    const rawHeight = movesTop
      ? anchorY - clamp(pointerY, 0, anchorY - 1)
      : clamp(pointerY, anchorY + 1, 100) - anchorY

    let width = clamp(rawWidth, 1, maxWidth)
    let height = clamp(rawHeight, 1, maxHeight)

    if (ratioPreset !== 'free') {
      const [ratioWidth, ratioHeight] = ratioPreset.split(':').map(Number)
      const imageRatio = selectedAsset.width / selectedAsset.height
      const percentRatio = (ratioWidth / ratioHeight) / imageRatio
      const widthFromHeight = rawHeight * percentRatio
      const widthDelta = Math.abs(rawWidth - drag.crop.width)
      const heightDeltaAsWidth = Math.abs(widthFromHeight - drag.crop.width)
      const requestedWidth = widthDelta >= heightDeltaAsWidth ? rawWidth : widthFromHeight
      const minimumWidth = Math.max(1, percentRatio)
      width = clamp(
        requestedWidth,
        Math.min(minimumWidth, maxWidth, maxHeight * percentRatio),
        Math.min(maxWidth, maxHeight * percentRatio),
      )
      height = width / percentRatio
    }

    setDraftCrop({
      x: movesLeft ? anchorX - width : anchorX,
      y: movesTop ? anchorY - height : anchorY,
      width,
      height,
    })
  }

  const handleCropPointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    cropDragRef.current = null
  }

  const renameSelectedAsset = (name: string) => {
    if (!selectedAssetId) return
    setAssets((current) =>
      current.map((asset) => (asset.id === selectedAssetId ? { ...asset, name } : asset)),
    )
  }

  const generateProcessedAsset = async () => {
    if (!selectedAsset || isProcessingAssets) return
    setIsProcessingAssets(true)
    try {
      const reservedNames = new Set(assets.map((asset) => asset.name.toLocaleLowerCase()))
      const templateLabel = cropTemplateName.trim() || '裁剪'
      const name = reserveProcessedAssetName(selectedAsset.name, templateLabel, reservedNames)
      const processedAsset = await createProcessedAsset(selectedAsset, draftCrop, name)
      setAssets((current) => [...current, processedAsset])
      setSelectedAssetId(processedAsset.id)
      setToast(`已生成“${processedAsset.name}”并加入素材库`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '裁剪结果生成失败')
    } finally {
      setIsProcessingAssets(false)
    }
  }

  const generateAllProcessedAssets = async () => {
    if (isProcessingAssets) return
    const sourceAssets = assets.filter((asset) => asset.origin !== 'processed')
    if (!sourceAssets.length) {
      setToast('没有可批量处理的原始素材')
      return
    }

    setIsProcessingAssets(true)
    setTemplate({ ...draftCrop })
    const reservedNames = new Set(assets.map((asset) => asset.name.toLocaleLowerCase()))
    const templateLabel = cropTemplateName.trim() || '裁剪'
    const outputNames = sourceAssets.map((asset) =>
      reserveProcessedAssetName(asset.name, templateLabel, reservedNames),
    )
    const generated: Array<Asset | null> = Array.from(
      { length: sourceAssets.length },
      () => null,
    )
    let nextAssetIndex = 0

    const worker = async () => {
      while (nextAssetIndex < sourceAssets.length) {
        const index = nextAssetIndex
        nextAssetIndex += 1
        try {
          generated[index] = await createProcessedAsset(
            sourceAssets[index],
            draftCrop,
            outputNames[index],
          )
        } catch {
          generated[index] = null
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(3, sourceAssets.length) }, () => worker()),
      )
      const validAssets = generated.filter((asset): asset is Asset => asset !== null)
      if (!validAssets.length) {
        setToast('批量裁剪失败，请检查素材是否可以正常读取')
        return
      }
      setAssets((current) => [...current, ...validAssets])
      setSelectedAssetId(validAssets[0].id)
      const failedCount = sourceAssets.length - validAssets.length
      setToast(
        `已生成 ${validAssets.length} 个素材并加入素材库${failedCount ? `，${failedCount} 个失败` : ''}`,
      )
    } finally {
      setIsProcessingAssets(false)
    }
  }

  const resetCrop = () => {
    setDraftCrop({ ...DEFAULT_CROP })
    setRatioPreset('free')
    setSelectedCropTemplateId('')
    setCropTemplateName('')
  }

  const chooseRatio = (value: string) => {
    setRatioPreset(value)
    if (value === 'free' || !selectedAsset) return
    const [ratioW, ratioH] = value.split(':').map(Number)
    const imageRatio = selectedAsset.width / selectedAsset.height
    const targetRatio = ratioW / ratioH
    if (imageRatio > targetRatio) {
      const width = (targetRatio / imageRatio) * 100
      setDraftCrop({ x: (100 - width) / 2, y: 0, width, height: 100 })
    } else {
      const height = (imageRatio / targetRatio) * 100
      setDraftCrop({ x: 0, y: (100 - height) / 2, width: 100, height })
    }
  }

  const saveCropTemplate = () => {
    const name = cropTemplateName.trim() || `裁剪模板 ${cropTemplates.length + 1}`
    const existing = cropTemplates.find((preset) => preset.name === name)
    const preset: CropTemplatePreset = {
      id: existing?.id ?? createUniqueId('crop-template'),
      name,
      crop: { ...draftCrop },
      ratioPreset,
      createdAt: existing?.createdAt ?? Date.now(),
    }

    setCropTemplates((current) =>
      existing
        ? current.map((item) => (item.id === existing.id ? preset : item))
        : [...current, preset],
    )
    setSelectedCropTemplateId(preset.id)
    setCropTemplateName(name)
    setTemplate({ ...draftCrop })
    setToast(existing ? `已更新模板“${name}”` : `已保存模板“${name}”`)
  }

  const loadCropTemplate = () => {
    const preset = cropTemplates.find((item) => item.id === selectedCropTemplateId)
    if (!preset) {
      setToast('请先选择裁剪模板')
      return
    }
    setDraftCrop({ ...preset.crop })
    setTemplate({ ...preset.crop })
    setRatioPreset(preset.ratioPreset)
    setCropTemplateName(preset.name)
    setToast(`已调用模板“${preset.name}”`)
  }

  const deleteCropTemplate = () => {
    const preset = cropTemplates.find((item) => item.id === selectedCropTemplateId)
    if (!preset) return
    setCropTemplates((current) => current.filter((item) => item.id !== preset.id))
    setSelectedCropTemplateId('')
    setCropTemplateName('')
    setToast(`已删除模板“${preset.name}”`)
  }

  const updateRowLabelPosition = (value: number) => {
    const next = clamp(Math.round(value), -20, 40)
    setRowLabelOffset(next)
    if (linkLabelPositions) setColumnLabelOffset(next)
  }

  const updateColumnLabelPosition = (value: number) => {
    const next = clamp(Math.round(value), -20, 40)
    setColumnLabelOffset(next)
    if (linkLabelPositions) setRowLabelOffset(next)
  }

  const placeAsset = (cellIndex: number, assetId: string) => {
    setCells((current) =>
      current.map((cell, index) => (index === cellIndex ? { ...cell, assetId } : cell)),
    )
    setSelectedCell(cellIndex)
  }

  const handleAssetDoubleClick = (assetId: string) => {
    if (selectedCell === null) {
      setToast('请先在画布中选择一个单元格')
      return
    }
    placeAsset(selectedCell, assetId)
    setToast('素材已放入选中单元格')
  }

  const removeSelectedAsset = () => {
    if (!selectedAsset) return
    const nextAssets = assets.filter((asset) => asset.id !== selectedAsset.id)
    setAssets(nextAssets)
    setCells((current) =>
      current.map((cell) =>
        cell.assetId === selectedAsset.id ? { ...cell, assetId: undefined } : cell,
      ),
    )
    setSelectedAssetId(nextAssets[0]?.id ?? '')
    setToast('素材已从项目中移除')
  }

  const updateMagnifierRegion = (
    row: number,
    regionId: string,
    patch: Partial<MagnifierRegion>,
  ) => {
    setRowMagnifiers((current) =>
      current.map((item) =>
        item.row === row
          ? {
              ...item,
              regions: item.regions.map((region) =>
                region.id === regionId ? { ...region, ...patch } : region,
              ),
            }
          : item,
      ),
    )
  }

  const measureMagnifierLayout = () => {
    const artboard = artboardRef.current
    const source = artboard?.querySelector<HTMLElement>('.cell-source')
    const cell = source?.closest<HTMLElement>('.grid-cell')
    if (!artboard || !source || !cell || !artboard.offsetWidth) return null
    const artboardRect = artboard.getBoundingClientRect()
    const scale = artboardRect.width / artboard.offsetWidth
    if (!Number.isFinite(scale) || scale <= 0) return null
    return {
      sourceWidth: source.getBoundingClientRect().width / scale,
      cellWidth: cell.getBoundingClientRect().width / scale,
    }
  }

  const preserveSourceWidth = (targetWidth: number, remainingPasses = 3) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const layout = measureMagnifierLayout()
        if (!layout || targetWidth <= 0 || layout.sourceWidth <= 0 || layout.cellWidth <= 0) return
        const difference = targetWidth - layout.sourceWidth
        if (Math.abs(difference) < 0.5) return
        const sourceShare = layout.sourceWidth / layout.cellWidth
        const canvasDelta = (difference / sourceShare) * columns
        setCanvasWidth((current) =>
          clamp(Math.round(current + canvasDelta), 280, 6000),
        )
        if (remainingPasses > 1) preserveSourceWidth(targetWidth, remainingPasses - 1)
      }),
    )
  }

  const updateSourceImageScale = (value: number) => {
    const nextScale = clamp(Math.round(value), 50, 200)
    if (nextScale === sourceImageScale) return
    const scaleRatio = nextScale / sourceImageScale
    const layout = measureMagnifierLayout()

    if (layout && layout.sourceWidth > 0 && layout.cellWidth > 0) {
      const targetSourceWidth = layout.sourceWidth * scaleRatio
      const sourceShare = layout.sourceWidth / layout.cellWidth
      const canvasDelta = ((targetSourceWidth - layout.sourceWidth) / sourceShare) * columns
      setCanvasWidth((current) => clamp(Math.round(current + canvasDelta), 280, 6000))
    } else {
      setCanvasWidth((current) => clamp(Math.round(current * scaleRatio), 280, 6000))
    }
    setSourceImageScale(nextScale)
  }

  const setMagnifierRegionCount = (count: number) => {
    const wanted = clamp(Math.round(count), 1, MAX_MAGNIFIER_COUNT)
    const targetWidth = measureMagnifierLayout()?.sourceWidth ?? 0
    setRowMagnifiers((current) =>
      current.map((item) => {
        if (item.regions.length === wanted) return item
        const regions = item.regions.slice(0, wanted)
        while (regions.length < wanted) regions.push(defaultMagnifierRegion(regions.length))
        return { ...item, regions }
      }),
    )
    if (targetWidth) preserveSourceWidth(targetWidth)
  }

  const updateMagnifierBorderColor = (index: number, value: string) => {
    setMagnifierBorderColors((current) => {
      const colorIndex = index === 0 ? 0 : 1
      const next: [string, string] = [...current]
      next[colorIndex] = normalizeHexColor(value, current[colorIndex])
      return next
    })
  }

  const openMagnifierPanel = () => {
    setActiveElementPanel('magnifier')
  }

  const toggleGlobalMagnifiers = () => {
    const targetWidth = measureMagnifierLayout()?.sourceWidth ?? 0
    if (magnifiersEnabled) {
      setMagnifiersEnabled(false)
      setSelectedMagnifierRegionId(null)
      setToast('已关闭全图局部放大，原图尺寸保持不变')
    } else {
      setRowMagnifiers((current) => {
        const count = current[0]?.regions.length ?? DEFAULT_MAGNIFIER_COUNT
        return Array.from(
          { length: rows },
          (_, row) => current.find((item) => item.row === row) ?? createRowMagnifier(row, count),
        )
      })
      setMagnifiersEnabled(true)
      setToast(`已为全部 ${rows} 行开启局部放大，画布已自动加宽`)
    }
    setActiveElementPanel('magnifier')
    if (targetWidth) preserveSourceWidth(targetWidth)
  }

  const handleMagnifierPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    row: number,
    region: MagnifierRegion,
    mode: 'move' | 'resize',
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    magnifierDragRef.current = {
      row,
      regionId: region.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originX: region.x,
      originY: region.y,
      originSize: region.size,
    }
    setSelectedMagnifierRegionId(region.id)
    setActiveElementPanel('magnifier')
  }

  const handleMagnifierPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = magnifierDragRef.current
    const source = event.currentTarget.closest('.cell-source') as HTMLElement | null
    if (!drag || !source) return

    const rect = source.getBoundingClientRect()
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 100
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 100

    if (drag.mode === 'move') {
      updateMagnifierRegion(drag.row, drag.regionId, {
        x: clamp(
          drag.originX + deltaX,
          0,
          100 - drag.originSize * magnifierRoiWidthFactor,
        ),
        y: clamp(drag.originY + deltaY, 0, 100 - drag.originSize),
      })
    } else {
      const widthDeltaAsSize = deltaX / magnifierRoiWidthFactor
      const deltaSize =
        Math.abs(widthDeltaAsSize) > Math.abs(deltaY) ? widthDeltaAsSize : deltaY
      updateMagnifierRegion(drag.row, drag.regionId, {
        size: clamp(
          drag.originSize + deltaSize,
          12,
          Math.min(
            48,
            (100 - drag.originX) / magnifierRoiWidthFactor,
            100 - drag.originY,
          ),
        ),
      })
    }
  }

  const handleMagnifierPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    magnifierDragRef.current = null
  }

  const exportProject = () => {
    const data = {
      projectName,
      layout: {
        rows,
        columns,
        gap,
        fitDrawing,
        canvasWidth,
        canvasMinHeight,
        canvasPadding,
      },
      cropTemplate: template,
      assets: assets.map(({ id, name, width, height, crop }) => ({
        id,
        name,
        width,
        height,
        crop,
      })),
      cells,
      labels: {
        show: showLabels,
        columns: columnLabels,
        rows: rowLabels,
        linkPositions: linkLabelPositions,
        rowOffset: rowLabelOffset,
        columnOffset: columnLabelOffset,
      },
      rowMagnifiers,
      magnifiersEnabled,
      magnifierBorderColors,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${projectName.replace(/[^\w\u4e00-\u9fa5]+/g, '_')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    setToast('项目配置已导出')
  }

  const openSystemPrintPdf = async () => {
    const node = artboardRef.current
    if (!node) return

    await document.fonts.ready
    await Promise.all(
      Array.from(node.querySelectorAll('img')).map((image) =>
        image.decode ? image.decode().catch(() => undefined) : Promise.resolve(),
      ),
    )
    const cssWidth = node.offsetWidth
    const cssHeight = node.offsetHeight
    const previousTitle = document.title
    const pageStyle = document.createElement('style')
    pageStyle.id = VECTOR_PRINT_STYLE_ID
    pageStyle.textContent = `
      @page { size: ${cssWidth}px ${cssHeight}px; margin: 0; }
      @media print {
        #picture-array-artboard {
          width: ${cssWidth}px !important;
          height: ${cssHeight}px !important;
        }
      }
    `

    document.getElementById(VECTOR_PRINT_STYLE_ID)?.remove()
    document.head.appendChild(pageStyle)
    document.title = projectName.replace(/[^\w\u4e00-\u9fa5]+/g, '_') || PRODUCT_NAME
    document.body.classList.add('vector-pdf-printing')

    const cleanup = () => {
      document.body.classList.remove('vector-pdf-printing')
      document.getElementById(VECTOR_PRINT_STYLE_ID)?.remove()
      document.title = previousTitle
      window.removeEventListener('afterprint', cleanup)
    }

    window.addEventListener('afterprint', cleanup, { once: true })
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
    )

    try {
      window.print()
    } finally {
      window.setTimeout(cleanup, 500)
    }
  }

  const exportVectorPdf = async () => {
    const node = artboardRef.current
    if (!node) return

    const fileName = projectName.replace(/[^\w\u4e00-\u9fa5]+/g, '_') || PRODUCT_FILE_NAME
    const { exportArtboardPdf } = await import('./pdfExport')
    await exportArtboardPdf({ node, fileName, title: projectName })
  }

  const exportFigure = async () => {
    if (!artboardRef.current || isExporting) return

    setIsExporting(true)
    setToast(
      exportFormat === 'pdf'
        ? '正在准备矢量 PDF…'
        : `正在生成高清 ${exportFormat.toUpperCase()}…`,
    )

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      if (exportFormat === 'pdf') {
        await exportVectorPdf()
        setExportOpen(false)
        setToast('自定义尺寸矢量 PDF 已导出')
        return
      }

      await document.fonts.ready
      const node = artboardRef.current
      const cssWidth = node.offsetWidth
      const cssHeight = node.offsetHeight
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: exportScale,
        backgroundColor: '#ffffff',
        width: cssWidth,
        height: cssHeight,
        style: {
          transform: 'none',
          margin: '0',
        },
      })
      const fileName = projectName.replace(/[^\w\u4e00-\u9fa5]+/g, '_')

      const link = document.createElement('a')
      link.download = `${fileName}.png`
      link.href = dataUrl
      link.click()

      setExportOpen(false)
      setToast('PNG 已导出')
    } catch (error) {
      console.error(error)
      setToast(
        exportFormat === 'pdf'
          ? 'PDF 导出失败，请检查字体与图片素材是否可读取'
          : '导出失败，请降低清晰度后重试',
      )
    } finally {
      setIsExporting(false)
    }
  }

  const createProjectSnapshot = (): ProjectSnapshot => ({
    projectName,
    rows,
    columns,
    gap,
    zoom,
    assets,
    cells,
    template,
    columnLabels,
    rowLabels,
    showLabels,
    fitDrawing,
    canvasWidth,
    canvasMinHeight,
    canvasPadding,
    linkLabelPositions,
    rowLabelOffset,
    columnLabelOffset,
    sourceImageScale,
    labelFontSize,
    labelBold,
    labelItalic,
    rowMagnifiers,
    magnifiersEnabled,
    magnifierBorderColors,
  })

  const saveDraft = () => {
    try {
      const snapshot = createProjectSnapshot()
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot))
      setSaveStatus('本地草稿已保存')
      setToast('当前项目已保存到本地')
    } catch {
      setSaveStatus('保存空间不足')
      setToast('素材较大，请先导出配置')
    }
  }

  const refreshWorkspaceTemplates = async (preferredId?: string) => {
    const summaries = await listWorkspaceTemplates()
    setWorkspaceTemplates(summaries)
    setSelectedWorkspaceTemplateId((current) => {
      const wanted = preferredId ?? current
      return summaries.some((item) => item.id === wanted) ? wanted : summaries[0]?.id ?? ''
    })
  }

  const openWorkspaceLibrary = async () => {
    setWorkspaceOpen(true)
    setWorkspaceTemplateName(projectName)
    setIsWorkspaceBusy(true)
    try {
      await refreshWorkspaceTemplates()
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate()
        if (estimate.quota) {
          setWorkspaceStorageText(
            `${formatStorageBytes(estimate.usage ?? 0)} / ${formatStorageBytes(estimate.quota)}`,
          )
        }
      }
    } catch (error) {
      console.error(error)
      setToast('无法读取工作空间模板，请检查浏览器存储权限')
    } finally {
      setIsWorkspaceBusy(false)
    }
  }

  const saveCurrentWorkspaceTemplate = async () => {
    if (isWorkspaceBusy) return
    const name = workspaceTemplateName.trim() || projectName.trim() || `工作空间 ${workspaceTemplates.length + 1}`
    const snapshot = createProjectSnapshot()
    const existing = workspaceTemplates.find((item) => item.name === name)
    const now = Date.now()
    setIsWorkspaceBusy(true)
    try {
      await saveWorkspaceTemplate<ProjectSnapshot>({
        id: existing?.id ?? createUniqueId('workspace'),
        name,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        assetCount: assets.length,
        rows,
        columns,
        byteSize: new Blob([JSON.stringify(snapshot)]).size,
        snapshot,
      })
      await refreshWorkspaceTemplates(existing?.id)
      setWorkspaceTemplateName(name)
      setToast(existing ? `已覆盖工作空间“${name}”` : `已保存工作空间“${name}”`)
    } catch (error) {
      console.error(error)
      setToast('工作空间保存失败，浏览器存储空间可能不足')
    } finally {
      setIsWorkspaceBusy(false)
    }
  }

  const restoreWorkspaceTemplate = async () => {
    if (!selectedWorkspaceTemplateId || isWorkspaceBusy) return
    setIsWorkspaceBusy(true)
    try {
      const record = await getWorkspaceTemplate<ProjectSnapshot>(selectedWorkspaceTemplateId)
      const snapshot = record?.snapshot
      if (!record || !snapshot || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.cells)) {
        throw new Error('工作空间模板数据不完整')
      }

      const restoredRows = clamp(Math.round(snapshot.rows || 1), 1, 24)
      const restoredColumns = clamp(Math.round(snapshot.columns || 1), 1, 24)
      const restoredAssets = snapshot.assets
      setProjectName(snapshot.projectName || record.name)
      setRows(restoredRows)
      setColumns(restoredColumns)
      setGap(clamp(Math.round(snapshot.gap ?? 12), 0, 80))
      setZoom(clamp(Math.round(snapshot.zoom ?? 84), 36, 140))
      setAssets(restoredAssets)
      setSelectedAssetId(restoredAssets[0]?.id ?? '')
      setCells(snapshot.cells)
      setTemplate(snapshot.template ?? { ...DEFAULT_CROP })
      setDraftCrop({ ...(restoredAssets[0]?.crop ?? snapshot.template ?? DEFAULT_CROP) })
      setColumnLabels(
        Array.from(
          { length: restoredColumns },
          (_, index) => snapshot.columnLabels?.[index] ?? defaultColumnLabel(index),
        ),
      )
      setRowLabels(
        Array.from(
          { length: restoredRows },
          (_, index) => snapshot.rowLabels?.[index] ?? defaultRowLabel(index),
        ),
      )
      setShowLabels(snapshot.showLabels ?? true)
      setFitDrawing(snapshot.fitDrawing ?? true)
      setCanvasWidth(clamp(Math.round(snapshot.canvasWidth ?? 760), 280, 6000))
      setCanvasMinHeight(clamp(Math.round(snapshot.canvasMinHeight ?? 400), 0, 2400))
      setCanvasPadding(clamp(Math.round(snapshot.canvasPadding ?? 28), 0, 160))
      setLinkLabelPositions(snapshot.linkLabelPositions ?? true)
      setRowLabelOffset(snapshot.rowLabelOffset ?? 3)
      setColumnLabelOffset(snapshot.columnLabelOffset ?? 3)
      setSourceImageScale(
        clamp(Math.round(snapshot.sourceImageScale ?? DEFAULT_SOURCE_IMAGE_SCALE), 50, 200),
      )
      setLabelFontSize(
        clamp(Math.round(snapshot.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE), 6, 48),
      )
      setLabelBold(snapshot.labelBold ?? true)
      setLabelItalic(snapshot.labelItalic ?? false)
      setRowMagnifiers(normalizeRowMagnifiers(snapshot.rowMagnifiers, restoredRows))
      setMagnifiersEnabled(snapshot.magnifiersEnabled ?? Boolean(snapshot.rowMagnifiers?.length))
      setMagnifierBorderColors(normalizeMagnifierBorderColors(snapshot.magnifierBorderColors))
      setSelectedCell(snapshot.cells.length ? 0 : null)
      setSelectedMagnifierRegionId(null)
      setActiveElementPanel('none')
      setWorkspaceOpen(false)
      setSaveStatus(`已恢复：${record.name}`)
      setToast(`工作空间“${record.name}”已恢复`)
    } catch (error) {
      console.error(error)
      setToast('工作空间恢复失败，模板数据可能已损坏')
    } finally {
      setIsWorkspaceBusy(false)
    }
  }

  const removeWorkspaceTemplate = async (id: string) => {
    const summary = workspaceTemplates.find((item) => item.id === id)
    if (!summary || isWorkspaceBusy) return
    if (!window.confirm(`确定删除工作空间“${summary.name}”吗？`)) return
    setIsWorkspaceBusy(true)
    try {
      await deleteWorkspaceTemplate(id)
      await refreshWorkspaceTemplates()
      setToast(`已删除工作空间“${summary.name}”`)
    } catch (error) {
      console.error(error)
      setToast('工作空间删除失败')
    } finally {
      setIsWorkspaceBusy(false)
    }
  }

  const safeRows = (value: number) => setRows(clamp(Math.round(value || 1), 1, 24))
  const safeColumns = (value: number) => setColumns(clamp(Math.round(value || 1), 1, 24))

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => <i key={index} />)}
          </div>
          <div>
            <div className="brand-name">Picture <span>Array</span></div>
            <div className="brand-subtitle">论文可视化工作台</div>
          </div>
        </div>

        <div className="project-title">
          {editingName ? (
            <input
              autoFocus
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(event) => event.key === 'Enter' && setEditingName(false)}
              aria-label="项目名称"
            />
          ) : (
            <button onClick={() => setEditingName(true)} title="点击编辑项目名称">
              {projectName}
            </button>
          )}
          <span><Check size={12} strokeWidth={2.5} /> {saveStatus}</span>
        </div>

        <div className="header-actions">
          <button className="icon-button" title="撤销" disabled><Undo2 size={17} /></button>
          <button className="icon-button" title="重做" disabled><Redo2 size={17} /></button>
          <span className="header-divider" />
          <button className="secondary-button workspace-trigger" onClick={() => void openWorkspaceLibrary()}>
            <Layers3 size={15} /> 工作空间
          </button>
          <button className="secondary-button export-trigger" onClick={() => setExportOpen(true)}>
            <Download size={15} /> 导出 PDF
          </button>
          <button className="primary-button" onClick={saveDraft}>
            <Save size={15} /> 保存
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel panel">
          <section className="asset-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">01 · SOURCE</span>
                <h2>素材库</h2>
              </div>
              <span className="count-badge">{assets.length}</span>
            </div>

            <div
              className={`import-zone ${isDraggingOver ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDraggingOver(true)
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                hidden
              />
              <div className="import-icon"><ImagePlus size={20} /></div>
              <div>
                <strong>拖入图片素材</strong>
                <span>PNG / JPG / WEBP</span>
              </div>
              <button onClick={() => fileInputRef.current?.click()}>
                <FolderOpen size={14} /> 浏览
              </button>
            </div>

            <div className="asset-toolbar">
              <span>全部素材</span>
              <span className="asset-hint">双击填入画布</span>
            </div>

            <div className="asset-grid">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  className={`asset-card ${selectedAssetId === asset.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAssetId(asset.id)}
                  onDoubleClick={() => handleAssetDoubleClick(asset.id)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <CroppedImage asset={asset} className="asset-thumb" />
                  <span className="asset-selected-mark"><Check size={11} /></span>
                  <span className="asset-name" title={asset.name}>{asset.name}</span>
                  <span className="asset-meta">
                    {asset.width} × {asset.height} · {formatBytes(asset.size)}
                  </span>
                </button>
              ))}
              <button className="add-asset-card" onClick={() => fileInputRef.current?.click()}>
                <Plus size={18} />
                <span>添加素材</span>
              </button>
            </div>
          </section>

          <section className="preprocess-section">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">02 · PREPROCESS</span>
                <h2>预处理模板</h2>
              </div>
              <button className="icon-button subtle" title="重置裁剪" onClick={resetCrop}>
                <RotateCcw size={15} />
              </button>
            </div>

            {selectedAsset ? (
              <>
                <label className="asset-rename-field">
                  <span><Type size={12} /> 素材名称</span>
                  <input
                    value={selectedAsset.name}
                    onChange={(event) => renameSelectedAsset(event.target.value)}
                    onBlur={(event) => {
                      const nextName = event.currentTarget.value.trim()
                      renameSelectedAsset(nextName || '未命名素材.png')
                    }}
                    aria-label="重命名当前素材"
                  />
                </label>
                <div className="preprocess-preview">
                  <svg
                    ref={cropPreviewRef}
                    className="crop-preview-svg"
                    viewBox={`0 0 ${selectedAsset.width} ${selectedAsset.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    aria-label="拖动四角调整裁剪区域"
                  >
                    <defs>
                      <mask
                        id="crop-preview-mask"
                        x="0"
                        y="0"
                        width={selectedAsset.width}
                        height={selectedAsset.height}
                        maskUnits="userSpaceOnUse"
                      >
                        <rect width={selectedAsset.width} height={selectedAsset.height} fill="white" />
                        <rect
                          x={(draftCrop.x / 100) * selectedAsset.width}
                          y={(draftCrop.y / 100) * selectedAsset.height}
                          width={(draftCrop.width / 100) * selectedAsset.width}
                          height={(draftCrop.height / 100) * selectedAsset.height}
                          fill="black"
                        />
                      </mask>
                    </defs>
                    <image
                      className="crop-source-image"
                      href={selectedAsset.src}
                      width={selectedAsset.width}
                      height={selectedAsset.height}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    <rect
                      className="crop-preview-dim"
                      width={selectedAsset.width}
                      height={selectedAsset.height}
                      mask="url(#crop-preview-mask)"
                    />
                    <rect
                      className="crop-selection-frame"
                      x={(draftCrop.x / 100) * selectedAsset.width}
                      y={(draftCrop.y / 100) * selectedAsset.height}
                      width={(draftCrop.width / 100) * selectedAsset.width}
                      height={(draftCrop.height / 100) * selectedAsset.height}
                    />
                    {CROP_CORNERS.map((corner) => {
                      const handleSize = Math.max(
                        8,
                        Math.min(selectedAsset.width, selectedAsset.height) * 0.065,
                      )
                      const isLeft = corner.includes('left')
                      const isTop = corner.includes('top')
                      const cornerX = ((isLeft ? draftCrop.x : draftCrop.x + draftCrop.width) / 100) * selectedAsset.width
                      const cornerY = ((isTop ? draftCrop.y : draftCrop.y + draftCrop.height) / 100) * selectedAsset.height
                      return (
                        <rect
                          key={corner}
                          className={`crop-resize-handle ${corner}`}
                          x={isLeft ? cornerX : cornerX - handleSize}
                          y={isTop ? cornerY : cornerY - handleSize}
                          width={handleSize}
                          height={handleSize}
                          onPointerDown={(event) => handleCropPointerDown(event, corner)}
                          onPointerMove={handleCropPointerMove}
                          onPointerUp={handleCropPointerUp}
                          onPointerCancel={handleCropPointerUp}
                        />
                      )
                    })}
                  </svg>
                  <div className="preview-label"><ScanLine size={12} /> 拖动四角裁剪</div>
                </div>

                <div className="ratio-row">
                  <span>裁剪比例</span>
                  <div>
                    {ratioPresets.map((preset) => (
                      <button
                        key={preset.value}
                        className={ratioPreset === preset.value ? 'active' : ''}
                        onClick={() => chooseRatio(preset.value)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="crop-fields">
                  <NumberField label="X" value={Math.round(draftCrop.x)} suffix="%" onChange={(value) => updateDraftCrop('x', value)} />
                  <NumberField label="Y" value={Math.round(draftCrop.y)} suffix="%" onChange={(value) => updateDraftCrop('y', value)} />
                  <NumberField label="W" value={Math.round(draftCrop.width)} suffix="%" min={1} onChange={(value) => updateDraftCrop('width', value)} />
                  <NumberField label="H" value={Math.round(draftCrop.height)} suffix="%" min={1} onChange={(value) => updateDraftCrop('height', value)} />
                </div>

                <div className="preprocess-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void generateProcessedAsset()}
                    disabled={isProcessingAssets}
                  >
                    {isProcessingAssets ? <LoaderCircle className="spin" size={13} /> : <ImagePlus size={13} />}
                    生成当前
                  </button>
                  <button
                    className="primary-button grow"
                    onClick={() => void generateAllProcessedAssets()}
                    disabled={isProcessingAssets || !assets.some((asset) => asset.origin !== 'processed')}
                  >
                    {isProcessingAssets ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}
                    批量生成 {assets.filter((asset) => asset.origin !== 'processed').length} 项
                  </button>
                </div>

                <div className="crop-template-library">
                  <div className="crop-template-title">
                    <span><Save size={12} /> 裁剪模板库</span>
                    <small>{cropTemplates.length} 个模板</small>
                  </div>
                  <div className="crop-template-save-row">
                    <input
                      value={cropTemplateName}
                      placeholder="输入模板名称"
                      onChange={(event) => setCropTemplateName(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && saveCropTemplate()}
                    />
                    <button onClick={saveCropTemplate}><Save size={12} /> 保存</button>
                  </div>
                  {cropTemplates.length ? (
                    <div className="crop-template-load-row">
                      <select
                        value={selectedCropTemplateId}
                        onChange={(event) => {
                          setSelectedCropTemplateId(event.target.value)
                          const preset = cropTemplates.find((item) => item.id === event.target.value)
                          if (preset) setCropTemplateName(preset.name)
                        }}
                        aria-label="选择裁剪模板"
                      >
                        <option value="">选择已保存模板</option>
                        {cropTemplates.map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.name}</option>
                        ))}
                      </select>
                      <button
                        className="load-template-button"
                        onClick={loadCropTemplate}
                        disabled={!selectedCropTemplateId}
                      >
                        <FolderOpen size={12} /> 调用
                      </button>
                      <button
                        className="delete-template-button"
                        onClick={deleteCropTemplate}
                        disabled={!selectedCropTemplateId}
                        title="删除模板"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ) : (
                    <small className="crop-template-empty">保存后可在其他项目中直接调用</small>
                  )}
                </div>

                <div className="template-info">
                  <Sparkles size={14} />
                  <span>生成结果会作为新 PNG 素材入库，原素材保持不变</span>
                </div>
              </>
            ) : (
              <div className="empty-preprocess">
                <FileImage size={25} />
                <span>导入并选择素材后开始预处理</span>
              </div>
            )}
          </section>
        </aside>

        <section className="center-panel">
          <div className="canvas-toolbar">
            <div className="toolbar-group dimension-controls">
              <div className="mini-field">
                <Rows3 size={14} />
                <span>行</span>
                <button onClick={() => safeRows(rows - 1)} aria-label="减少一行"><Minus size={12} /></button>
                <input
                  aria-label="行数"
                  type="number"
                  min="1"
                  max="24"
                  value={rows}
                  onChange={(event) => safeRows(Number(event.target.value))}
                />
                <button onClick={() => safeRows(rows + 1)} aria-label="增加一行"><Plus size={12} /></button>
              </div>
              <div className="mini-field">
                <Columns3 size={14} />
                <span>列</span>
                <button onClick={() => safeColumns(columns - 1)} aria-label="减少一列"><Minus size={12} /></button>
                <input
                  aria-label="列数"
                  type="number"
                  min="1"
                  max="24"
                  value={columns}
                  onChange={(event) => safeColumns(Number(event.target.value))}
                />
                <button onClick={() => safeColumns(columns + 1)} aria-label="增加一列"><Plus size={12} /></button>
              </div>
            </div>

            <span className="toolbar-divider" />

            <label className="gap-control">
              <AlignHorizontalSpaceAround size={14} />
              <span>间距</span>
              <input
                type="range"
                min="0"
                max="32"
                value={gap}
                onChange={(event) => setGap(Number(event.target.value))}
              />
              <b>{gap}</b>
            </label>

            <button
              className={`fit-drawing-button ${fitDrawing ? 'active' : ''}`}
              onClick={() => {
                setFitDrawing((current) => !current)
                setToast(fitDrawing ? '已恢复页面留白' : '页面已适应绘图大小')
              }}
              title="使白色页面边界紧贴绘图内容"
              aria-pressed={fitDrawing}
            >
              <SquareDashed size={14} />
              <span>适应绘图</span>
            </button>

            <div className="toolbar-spacer" />

            <div className="zoom-control">
              <button onClick={() => setZoom((value) => clamp(value - 8, 36, 140))} title="缩小">
                <ZoomOut size={15} />
              </button>
              <span>{zoom}%</span>
              <button onClick={() => setZoom((value) => clamp(value + 8, 36, 140))} title="放大">
                <ZoomIn size={15} />
              </button>
            </div>
          </div>

          <div className="canvas-stage">
            <div className="stage-meta">
              <span><MousePointer2 size={13} /> 选择单元格后，双击或拖入左侧素材</span>
              <span>{rows} × {columns} · {rows * columns} 个单元格</span>
            </div>

            <div className="artboard-wrap">
              <div
                className="artboard-scale"
                style={{
                  width: `${canvasWidth}px`,
                  minWidth: 0,
                  transform: `scale(${zoom / 100})`,
                }}
              >
                <div
                  id="picture-array-artboard"
                  className={`artboard ${fitDrawing ? 'fit-drawing' : ''} ${isExporting ? 'exporting' : ''}`}
                  ref={artboardRef}
                  style={{
                    ...magnifierColorVariables,
                    ...(fitDrawing
                      ? {}
                      : {
                          minHeight: `${canvasMinHeight}px`,
                          padding: `${canvasPadding}px`,
                        }),
                  }}
                  onClick={() => {
                    setActiveElementPanel('canvas')
                  }}
                >
                  <div className={`matrix-layout ${showLabels ? 'with-labels' : 'labels-hidden'}`}>
                    {showLabels && (
                      <>
                        <div
                          className="column-label-grid"
                          style={{
                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                            gap: `${gap}px`,
                          }}
                        >
                          {columnLabels.map((label, index) => (
                            <button
                              key={index}
                              data-export-text={label}
                              className={`${labelBold ? 'label-bold' : ''} ${labelItalic ? 'label-italic' : ''}`}
                              style={{
                                top: `${columnLabelOffset}px`,
                                fontSize: `${labelFontSize}px`,
                                fontWeight: labelBold ? 700 : 400,
                                fontStyle: labelItalic ? 'italic' : 'normal',
                              }}
                              onClick={(event) => {
                                event.stopPropagation()
                                setActiveElementPanel('labels')
                              }}
                            >
                              <MathText value={label} />
                            </button>
                          ))}
                        </div>
                        <div
                          className="row-label-grid"
                          style={{
                            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                            gap: `${gap}px`,
                          }}
                        >
                          {rowLabels.map((label, index) => (
                            <button
                              key={index}
                              data-export-text={label}
                              className={`${labelBold ? 'label-bold' : ''} ${labelItalic ? 'label-italic' : ''}`}
                              style={{
                                left: `${-rowLabelOffset}px`,
                                fontSize: `${labelFontSize}px`,
                                fontWeight: labelBold ? 700 : 400,
                                fontStyle: labelItalic ? 'italic' : 'normal',
                              }}
                              onClick={(event) => {
                                event.stopPropagation()
                                setActiveElementPanel('labels')
                              }}
                            >
                              <MathText value={label} />
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div
                      className="result-grid"
                      style={{
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        gap: `${gap}px`,
                      }}
                    >
                    {cells.map((cell, index) => {
                      const asset = assets.find((item) => item.id === cell.assetId)
                      const rowIndex = Math.floor(index / columns)
                      const cellRoiWidthFactor = 1 / (asset ? croppedAspectRatio(asset) : layoutAspectRatio)
                      const rowMagnifier = magnifiersEnabled
                        ? rowMagnifiers.find((item) => item.row === rowIndex)
                        : undefined
                      const magnifierColumnCount = rowMagnifier
                        ? Math.ceil(rowMagnifier.regions.length / 2)
                        : 0
                      const cellAspectRatio =
                        layoutAspectRatio +
                        magnifierColumnCount * 0.48 +
                        (magnifierColumnCount ? magnifierColumnCount * 0.035 : 0)
                      const isMagnifierEditing =
                        Boolean(rowMagnifier) &&
                        selectedCell === index &&
                        activeElementPanel === 'magnifier'
                      return (
                        <button
                          key={index}
                          className={`grid-cell ${selectedCell === index ? 'selected' : ''} ${asset ? 'filled' : ''} ${rowMagnifier ? 'has-magnifier' : ''}`}
                          style={{ aspectRatio: `${cellAspectRatio} / 1` }}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedCell(index)
                          }}
                          onDragOver={(event) => {
                            if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'copy'
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE)
                            if (assetId) placeAsset(index, assetId)
                          }}
                        >
                          <span
                            className="cell-media"
                            style={{
                              gridTemplateColumns: rowMagnifier
                                ? `minmax(0, ${layoutAspectRatio}fr) minmax(0, ${0.48 * magnifierColumnCount}fr)`
                                : 'minmax(0, 1fr)',
                            }}
                          >
                            <span className="cell-source">
                              {asset ? (
                                <>
                                  <CroppedImage asset={asset} className="cell-image" />
                                  <span className="cell-overlay">
                                    <Move size={14} />
                                  </span>
                                  {rowMagnifier?.regions.map((region, regionIndex) => {
                                    const isRegionSelected =
                                      isMagnifierEditing &&
                                      selectedMagnifierRegion?.id === region.id
                                    return (
                                      <span
                                        key={region.id}
                                        data-region-color={magnifierBorderColors[regionIndex % 2]}
                                        className={`row-magnifier-roi region-${regionIndex % 2} ${isMagnifierEditing ? 'editable' : ''} ${isRegionSelected ? 'selected-region' : ''}`}
                                        style={{
                                          left: `${region.x}%`,
                                          top: `${region.y}%`,
                                          width: `${region.size * cellRoiWidthFactor}%`,
                                          height: `${region.size}%`,
                                        }}
                                        onPointerDown={
                                          isMagnifierEditing
                                            ? (event) =>
                                                handleMagnifierPointerDown(
                                                  event,
                                                  rowIndex,
                                                  region,
                                                  'move',
                                                )
                                            : undefined
                                        }
                                        onPointerMove={isMagnifierEditing ? handleMagnifierPointerMove : undefined}
                                        onPointerUp={isMagnifierEditing ? handleMagnifierPointerUp : undefined}
                                        onPointerCancel={isMagnifierEditing ? handleMagnifierPointerUp : undefined}
                                      >
                                        {isRegionSelected && (
                                          <i
                                            className="row-magnifier-resize"
                                            onPointerDown={(event) =>
                                              handleMagnifierPointerDown(
                                                event,
                                                rowIndex,
                                                region,
                                                'resize',
                                              )
                                            }
                                          />
                                        )}
                                      </span>
                                    )
                                  })}
                                  <span className="cell-filename">{asset.name}</span>
                                </>
                              ) : (
                                <span className="empty-cell-content">
                                  <ImagePlus size={19} />
                                  <span>拖入素材</span>
                                </span>
                              )}
                            </span>

                            {rowMagnifier && (
                              <span className="row-magnifier-rail">
                                {Array.from({ length: magnifierColumnCount }, (_, railIndex) => {
                                  const columnRegions = rowMagnifier.regions.slice(
                                    railIndex * 2,
                                    railIndex * 2 + 2,
                                  )
                                  return (
                                    <span
                                      key={railIndex}
                                      className={`row-magnifier-column ${columnRegions.length === 1 ? 'single' : ''}`}
                                    >
                                      {columnRegions.map((region) => {
                                        const regionIndex = rowMagnifier.regions.findIndex(
                                          (item) => item.id === region.id,
                                        )
                                        const magnifiedAsset = asset
                                          ? {
                                              ...asset,
                                              crop: cropWithinCrop(
                                                asset.crop,
                                                region,
                                                cellRoiWidthFactor,
                                              ),
                                            }
                                          : null
                                        return (
                                          <span
                                            key={region.id}
                                            data-region-color={magnifierBorderColors[regionIndex % 2]}
                                            className={`row-magnifier-inset region-${regionIndex % 2}`}
                                          >
                                            {magnifiedAsset ? (
                                              <CroppedImage
                                                asset={magnifiedAsset}
                                                className="row-magnifier-image"
                                              />
                                            ) : (
                                              <span className="row-magnifier-placeholder" />
                                            )}
                                          </span>
                                        )
                                      })}
                                    </span>
                                  )
                                })}
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="right-panel panel">
          <section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">03 · ELEMENTS</span>
                <h2>元素面板</h2>
              </div>
              <button className="icon-button subtle" title="面板设置"><Settings2 size={16} /></button>
            </div>

            <div className="panel-group">
              <div className="group-title">
                <span>常用元素</span>
                <ChevronDown size={14} />
              </div>
              <div className="element-grid">
                <button
                  className={activeElementPanel === 'labels' ? 'active' : ''}
                  onClick={() => {
                    setShowLabels(true)
                    setActiveElementPanel('labels')
                  }}
                >
                  <Grid2X2 size={20} />
                  <span>行列标签</span>
                  <small>编辑方法与样本</small>
                </button>
                <button
                  className={activeElementPanel === 'canvas' ? 'active' : ''}
                  onClick={() => {
                    setActiveElementPanel('canvas')
                  }}
                >
                   <SquareDashed size={20} />
                   <span>画布 / 图像尺寸</span>
                   <small>原图、局部图与页面</small>
                </button>
              </div>
            </div>

            <div className="panel-group">
              <div className="group-title">
                <span>科学绘图</span>
                <ChevronDown size={14} />
              </div>
              <div className="element-list">
                <button
                  className={activeElementPanel === 'magnifier' ? 'active' : ''}
                  onClick={openMagnifierPanel}
                >
                  <span className="element-icon"><ZoomIn size={16} /></span>
                  <span>
                    <b>局部放大</b>
                    <small>{magnifiersEnabled ? `已应用到全部 ${rows} 行` : '全图统一开关 · 自动扩展画布'}</small>
                  </span>
                  {magnifiersEnabled ? <Check size={14} /> : <Plus size={14} />}
                </button>
              </div>
            </div>

            <div className="panel-group selection-group">
              <div className="group-title">
                <span>
                  {activeElementPanel === 'labels'
                    ? '行列标签'
                    : activeElementPanel === 'canvas'
                      ? '画布尺寸'
                    : activeElementPanel === 'magnifier'
                      ? '局部放大'
                      : '当前选择'}
                </span>
                <SlidersHorizontal size={14} />
              </div>
              {activeElementPanel === 'canvas' ? (
                <div className="canvas-editor">
                  <button
                    className={`canvas-fit-toggle ${fitDrawing ? 'active' : ''}`}
                    onClick={() => setFitDrawing((current) => !current)}
                  >
                    <span className="canvas-fit-icon"><SquareDashed size={16} /></span>
                    <span>
                      <b>适应绘图大小</b>
                      <small>{fitDrawing ? '高度与边距自动紧贴内容' : '当前使用手动画布参数'}</small>
                    </span>
                    <i />
                  </button>

                  <div className="source-image-scale-panel">
                    <div className="source-image-scale-heading">
                      <ImageIcon size={14} />
                      <span>
                        <b>原图与局部图大小</b>
                        <small>调整实际导出尺寸，局部放大图同步等比例缩放</small>
                      </span>
                      <strong>{sourceImageScale}%</strong>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="200"
                      step="5"
                      value={sourceImageScale}
                      onChange={(event) => updateSourceImageScale(Number(event.target.value))}
                      aria-label="原图与局部放大图大小"
                    />
                    <div className="source-image-scale-presets">
                      {[75, 100, 125, 150].map((preset) => (
                        <button
                          key={preset}
                          className={sourceImageScale === preset ? 'active' : ''}
                          onClick={() => updateSourceImageScale(preset)}
                        >
                          {preset}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="canvas-dimension-grid">
                    <NumberField
                      label="画布宽度"
                      value={canvasWidth}
                      suffix="px"
                      min={280}
                      max={6000}
                      onChange={(value) => setCanvasWidth(clamp(Math.round(value || 280), 280, 6000))}
                    />
                    <NumberField
                      label="最小高度"
                      value={canvasMinHeight}
                      suffix="px"
                      min={0}
                      max={2400}
                      onChange={(value) => {
                        setCanvasMinHeight(clamp(Math.round(value || 0), 0, 2400))
                        setFitDrawing(false)
                      }}
                    />
                    <NumberField
                      label="页面边距"
                      value={canvasPadding}
                      suffix="px"
                      min={0}
                      max={160}
                      onChange={(value) => {
                        setCanvasPadding(clamp(Math.round(value || 0), 0, 160))
                        setFitDrawing(false)
                      }}
                    />
                  </div>

                  <div className="canvas-size-summary">
                    <Info size={13} />
                    <span>
                      <b>{canvasWidth}px × {fitDrawing ? '自动高度' : `至少 ${canvasMinHeight}px`}</b>
                      <small>PDF 与 PNG 会使用这里的实际画布边界</small>
                    </span>
                  </div>

                  <button
                    className="canvas-reset-button"
                    onClick={() => {
                      setCanvasWidth(760)
                      setCanvasMinHeight(400)
                      setCanvasPadding(28)
                      setSourceImageScale(DEFAULT_SOURCE_IMAGE_SCALE)
                      setFitDrawing(true)
                      setToast('画布尺寸已恢复默认')
                    }}
                  >
                    <RotateCcw size={13} /> 恢复默认画布
                  </button>
                </div>
              ) : activeElementPanel === 'magnifier' ? (
                <div className="magnifier-global-editor" style={magnifierColorVariables}>
                  <button
                    className={`magnifier-global-toggle ${magnifiersEnabled ? 'active' : ''}`}
                    onClick={toggleGlobalMagnifiers}
                  >
                    <span>
                      <b>全图统一局部放大</b>
                      <small>
                        {magnifiersEnabled
                          ? `已覆盖全部 ${rows} 行，原图尺寸保持不变`
                          : '开启后为所有图增加右侧局部图列'}
                      </small>
                    </span>
                    <i />
                  </button>

                  {magnifiersEnabled && (
                    <div className="magnifier-color-control">
                      <span>
                        <b>局部图边框颜色</b>
                        <small>同步原图 ROI 与右侧局部图</small>
                      </span>
                      <div>
                        {magnifierBorderColors.map((color, index) => (
                          <label key={index}>
                            <input
                              type="color"
                              value={color}
                              aria-label={index === 0 ? '主边框颜色' : '次边框颜色'}
                              onChange={(event) => updateMagnifierBorderColor(index, event.target.value)}
                            />
                            <small>{index === 0 ? '主边框' : '次边框'}</small>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {magnifiersEnabled ? (
                    selectedRowIndex !== null && selectedRowMagnifier ? (
                  <div className="magnifier-editor">
                    <div className="magnifier-row-summary">
                      <span className="magnifier-summary-icon"><ZoomIn size={16} /></span>
                      <span>
                        <b>第 {selectedRowIndex + 1} 行 · ROI 定位</b>
                        <small>彩色框统一应用到本行 {columns} 个模型结果</small>
                      </span>
                      <i>{selectedRowMagnifier.regions.length} 张</i>
                    </div>

                    <div className="magnifier-count-control">
                      <span>
                        <b>局部图数量</b>
                        <small>全部行统一；超过两张时再增加右侧列</small>
                      </span>
                      <div>
                        {Array.from({ length: MAX_MAGNIFIER_COUNT }, (_, index) => index + 1).map(
                          (count) => (
                            <button
                              key={count}
                              className={selectedRowMagnifier.regions.length === count ? 'active' : ''}
                              onClick={() => setMagnifierRegionCount(count)}
                            >
                              {count}
                            </button>
                          ),
                        )}
                      </div>
                    </div>

                    <div className="magnifier-region-tabs">
                      {selectedRowMagnifier.regions.map((region, index) => (
                        <button
                          key={region.id}
                          className={`${selectedMagnifierRegion?.id === region.id ? 'active' : ''} region-${index % 2}`}
                          onClick={() => setSelectedMagnifierRegionId(region.id)}
                        >
                          <i /> {index % 2 === 0 ? '主边框' : '次边框'}
                        </button>
                      ))}
                    </div>

                    {selectedMagnifierRegion && (
                      <>
                        <div className="magnifier-tip">
                          <Move size={13} />
                          <span>拖动彩色框定位；拖动右下角可等比调整正方形 ROI。</span>
                        </div>

                        <div className="magnifier-field-title">
                          <span>
                            {selectedRowMagnifier.regions.findIndex(
                              (region) => region.id === selectedMagnifierRegion.id,
                            ) % 2 === 0 ? '主边框' : '次边框'}
                          </span>
                        </div>
                        <div className="magnifier-fields">
                          <NumberField
                            label="X"
                            value={Math.round(selectedMagnifierRegion.x)}
                            suffix="%"
                            onChange={(value) =>
                              updateMagnifierRegion(selectedRowIndex, selectedMagnifierRegion.id, {
                                x: clamp(
                                  value,
                                  0,
                                  100 - selectedMagnifierRegion.size * magnifierRoiWidthFactor,
                                ),
                              })
                            }
                          />
                          <NumberField
                            label="Y"
                            value={Math.round(selectedMagnifierRegion.y)}
                            suffix="%"
                            onChange={(value) =>
                              updateMagnifierRegion(selectedRowIndex, selectedMagnifierRegion.id, {
                                y: clamp(value, 0, 100 - selectedMagnifierRegion.size),
                              })
                            }
                          />
                          <NumberField
                            label="尺寸"
                            value={Math.round(selectedMagnifierRegion.size)}
                            suffix="%"
                            min={12}
                            max={48}
                            onChange={(value) =>
                              updateMagnifierRegion(selectedRowIndex, selectedMagnifierRegion.id, {
                                size: clamp(
                                  value,
                                  12,
                                  Math.min(
                                    48,
                                    (100 - selectedMagnifierRegion.x) / magnifierRoiWidthFactor,
                                    100 - selectedMagnifierRegion.y,
                                  ),
                                ),
                              })
                            }
                          />
                        </div>

                        <div className="magnifier-presets">
                          <span>快速定位</span>
                          <div>
                            <button
                              onClick={() =>
                                updateMagnifierRegion(selectedRowIndex, selectedMagnifierRegion.id, {
                                  x: 8,
                                  y: 8,
                                })
                              }
                            >
                              左上
                            </button>
                            <button
                              onClick={() =>
                                updateMagnifierRegion(selectedRowIndex, selectedMagnifierRegion.id, {
                                  x: (100 - selectedMagnifierRegion.size * magnifierRoiWidthFactor) / 2,
                                  y: (100 - selectedMagnifierRegion.size) / 2,
                                })
                              }
                            >
                              居中
                            </button>
                            <button
                              onClick={() =>
                                updateMagnifierRegion(selectedRowIndex, selectedMagnifierRegion.id, {
                                  x: 92 - selectedMagnifierRegion.size * magnifierRoiWidthFactor,
                                  y: 92 - selectedMagnifierRegion.size,
                                })
                              }
                            >
                              右下
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="magnifier-auto-position">
                      <Columns3 size={13} />
                      <span>
                        <b>右侧独立扩展列</b>
                        <small>原图不缩小 · 画布自动加宽 · 局部图保持正方形</small>
                      </span>
                    </div>
                  </div>
                    ) : (
                      <div className="magnifier-empty compact">
                        <MousePointer2 size={20} />
                        <span>局部放大已覆盖全图；选择任意单元格以调整该行红蓝 ROI。</span>
                      </div>
                    )
                  ) : (
                    <div className="magnifier-empty compact">
                      <ZoomIn size={20} />
                      <span>开启统一开关后，所有原图保持当前大小，画布向右自动扩展局部图列。</span>
                    </div>
                  )}
                </div>
              ) : activeElementPanel === 'labels' ? (
                <div className="label-editor">
                  <button
                    className={`label-visibility ${showLabels ? 'active' : ''}`}
                    onClick={() => setShowLabels((current) => !current)}
                  >
                    <span>
                      <b>显示行列标签</b>
                      <small>{showLabels ? '当前会随图片一同导出' : '标签已隐藏'}</small>
                    </span>
                    <i />
                  </button>

                  <div className="label-style-panel">
                    <label className="label-font-size-field">
                      <span>统一标签字号</span>
                      <div>
                        <input
                          type="number"
                          min="6"
                          max="48"
                          value={labelFontSize}
                          onChange={(event) =>
                            setLabelFontSize(
                              clamp(Number(event.target.value) || DEFAULT_LABEL_FONT_SIZE, 6, 48),
                            )
                          }
                        />
                        <small>px</small>
                      </div>
                    </label>
                    <div className="label-style-buttons">
                      <button
                        className={labelBold ? 'active' : ''}
                        onClick={() => setLabelBold((current) => !current)}
                        title="行列标签加粗"
                        aria-pressed={labelBold}
                      >
                        <Bold size={14} /> 加粗
                      </button>
                      <button
                        className={labelItalic ? 'active' : ''}
                        onClick={() => setLabelItalic((current) => !current)}
                        title="行列标签斜体"
                        aria-pressed={labelItalic}
                      >
                        <Italic size={14} /> 斜体
                      </button>
                    </div>
                  </div>

                  <div className="label-position-panel">
                    <button
                      className={`label-position-link ${linkLabelPositions ? 'active' : ''}`}
                      onClick={() => {
                        setLinkLabelPositions((current) => {
                          if (!current) setColumnLabelOffset(rowLabelOffset)
                          return !current
                        })
                      }}
                    >
                      <Move size={13} />
                      <span>
                        <b>统一调整标签位置</b>
                        <small>{linkLabelPositions ? '行标签左移与列标签下移保持一致' : '当前可分别调整'}</small>
                      </span>
                      <i />
                    </button>

                    <label className="label-position-slider">
                      <span>{linkLabelPositions ? '统一外移' : '行标签左移'}</span>
                      <input
                        type="range"
                        min="-20"
                        max="40"
                        value={rowLabelOffset}
                        onChange={(event) => updateRowLabelPosition(Number(event.target.value))}
                      />
                      <b>{rowLabelOffset}px</b>
                    </label>

                    {!linkLabelPositions && (
                      <label className="label-position-slider">
                        <span>列标签下移</span>
                        <input
                          type="range"
                          min="-20"
                          max="40"
                          value={columnLabelOffset}
                          onChange={(event) => updateColumnLabelPosition(Number(event.target.value))}
                        />
                        <b>{columnLabelOffset}px</b>
                      </label>
                    )}
                  </div>

                  <div className="latex-input-hint">
                    <Type size={12} />
                    <span>支持 LaTeX：<code>$E=mc^2$</code> 或 <code>$$E=mc^2$$</code></span>
                  </div>

                  <div className="label-input-group">
                    <div><Columns3 size={13} /> 列标签</div>
                    {columnLabels.map((label, index) => (
                      <label key={index}>
                        <span>{String.fromCharCode(65 + (index % 26))}</span>
                        <input
                          value={label}
                          placeholder={defaultColumnLabel(index)}
                          onChange={(event) =>
                            setColumnLabels((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? event.target.value : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>

                  <div className="label-input-group">
                    <div><Rows3 size={13} /> 行标签</div>
                    {rowLabels.map((label, index) => (
                      <label key={index}>
                        <span>{index + 1}</span>
                        <input
                          value={label}
                          placeholder={defaultRowLabel(index)}
                          onChange={(event) =>
                            setRowLabels((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? event.target.value : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : selectedCell !== null ? (
                <div className="selection-card">
                  <div className="selection-preview">
                    <SquareDashed size={23} />
                  </div>
                  <div>
                    <b>单元格 {String.fromCharCode(65 + (selectedCell % columns) % 26)}{Math.floor(selectedCell / columns) + 1}</b>
                    <span>{cells[selectedCell]?.assetId ? '已放置素材' : '等待填入素材'}</span>
                  </div>
                  {cells[selectedCell]?.assetId && (
                    <button
                      title="清空单元格"
                      onClick={() =>
                        setCells((current) =>
                          current.map((cell, index) =>
                            index === selectedCell ? { ...cell, assetId: undefined } : cell,
                          ),
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="selection-empty">尚未选择画布元素</div>
              )}
            </div>
          </section>

          {selectedAsset && (
            <button className="remove-asset-button" onClick={removeSelectedAsset}>
              <Trash2 size={14} /> 移除当前素材
            </button>
          )}
        </aside>
      </main>

      {exportOpen && (
        <div
          className="export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isExporting) setExportOpen(false)
          }}
        >
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <header>
              <div>
                <span className="eyebrow">EXPORT FIGURE</span>
                <h2 id="export-title">导出论文图</h2>
                <p>仅导出中间白色画布，不包含工作台界面。</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭导出窗口"
                onClick={() => setExportOpen(false)}
                disabled={isExporting}
              >
                <X size={18} />
              </button>
            </header>

            <div className="export-content">
              <div className="export-section">
                <div className="export-section-title">
                  <span>文件格式</span>
                  <small>PDF 为论文投稿首选</small>
                </div>
                <div className="format-options">
                  <button
                    className={exportFormat === 'pdf' ? 'selected' : ''}
                    onClick={() => setExportFormat('pdf')}
                  >
                    <span className="format-icon pdf"><FileDown size={22} /></span>
                    <span>
                      <b>矢量 PDF</b>
                      <small>文字与绘图元素保持矢量</small>
                    </span>
                    <i>推荐</i>
                    {exportFormat === 'pdf' && <Check size={15} className="format-check" />}
                  </button>
                  <button
                    className={exportFormat === 'png' ? 'selected' : ''}
                    onClick={() => setExportFormat('png')}
                  >
                    <span className="format-icon png"><ImageIcon size={22} /></span>
                    <span>
                      <b>PNG</b>
                      <small>适合插入文档的高清位图</small>
                    </span>
                    {exportFormat === 'png' && <Check size={15} className="format-check" />}
                  </button>
                </div>
              </div>

              {exportFormat === 'png' ? (
                <div className="export-section">
                  <div className="export-section-title">
                    <span>输出清晰度</span>
                    <small>
                      约 {Math.round((artboardRef.current?.offsetWidth ?? 640) * exportScale)}
                      {' × '}
                      {Math.round((artboardRef.current?.offsetHeight ?? 480) * exportScale)} px
                    </small>
                  </div>
                  <div className="quality-options">
                    <button
                      className={exportScale === 2 ? 'selected' : ''}
                      onClick={() => setExportScale(2)}
                    >
                      <b>2× 标准</b>
                      <small>预览与日常分享</small>
                    </button>
                    <button
                      className={exportScale === 3 ? 'selected' : ''}
                      onClick={() => setExportScale(3)}
                    >
                      <b>3× 高清</b>
                      <small>论文投稿与印刷</small>
                      <i>默认</i>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="export-section vector-export-info">
                  <div><Sparkles size={17} /></div>
                  <span>
                    <b>Visio 式混合矢量输出</b>
                    <small>文字、标签、边框和 ROI 为矢量；PNG/JPG 原图按原始像素嵌入。</small>
                    <em>按画布真实宽高直接下载，不受 A4、A3 等打印纸张限制。</em>
                    <button
                      type="button"
                      className="vector-print-fallback"
                      onClick={() => {
                        setExportOpen(false)
                        void openSystemPrintPdf()
                      }}
                    >
                      仍使用系统打印
                    </button>
                  </span>
                </div>
              )}

              <div className="export-summary">
                <div><Layers3 size={15} /> 当前图阵</div>
                <span>{rows} 行 × {columns} 列 · 白色背景 · 完整画布</span>
              </div>
            </div>

            <footer>
              <button className="config-export-link" onClick={exportProject} disabled={isExporting}>
                <Download size={14} /> 导出项目配置 (.json)
              </button>
              <button className="primary-button export-confirm" onClick={() => void exportFigure()} disabled={isExporting}>
                {isExporting ? (
                  <><LoaderCircle size={16} className="spin" /> 正在准备…</>
                ) : (
                  <><Download size={16} /> {exportFormat === 'pdf' ? '直接下载 PDF' : '导出 PNG'}</>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}

      {workspaceOpen && (
        <div
          className="export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isWorkspaceBusy) setWorkspaceOpen(false)
          }}
        >
          <section
            className="export-dialog workspace-template-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-template-title"
          >
            <header>
              <div>
                <span className="eyebrow">WORKSPACE LIBRARY</span>
                <h2 id="workspace-template-title">工作空间模板</h2>
                <p>完整保存素材、裁剪、布局、标签和局部放大设置。</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭工作空间模板"
                onClick={() => setWorkspaceOpen(false)}
                disabled={isWorkspaceBusy}
              >
                <X size={18} />
              </button>
            </header>

            <div className="workspace-template-content">
              <div className="workspace-save-panel">
                <div>
                  <b>保存当前工作空间</b>
                  <small>同名模板会直接覆盖，素材图片也会一并保存。</small>
                </div>
                <div className="workspace-save-row">
                  <input
                    value={workspaceTemplateName}
                    placeholder={projectName || '输入模板名称'}
                    onChange={(event) => setWorkspaceTemplateName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveCurrentWorkspaceTemplate()
                    }}
                    disabled={isWorkspaceBusy}
                  />
                  <button
                    className="primary-button"
                    onClick={() => void saveCurrentWorkspaceTemplate()}
                    disabled={isWorkspaceBusy}
                  >
                    {isWorkspaceBusy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                    保存模板
                  </button>
                </div>
              </div>

              <div className="workspace-library-heading">
                <span>已保存模板 <b>{workspaceTemplates.length}</b></span>
                {workspaceStorageText && <small>浏览器存储 {workspaceStorageText}</small>}
              </div>

              <div className="workspace-template-list">
                {workspaceTemplates.length ? (
                  workspaceTemplates.map((item) => (
                    <div
                      key={item.id}
                      className={`workspace-template-card ${selectedWorkspaceTemplateId === item.id ? 'selected' : ''}`}
                    >
                      <button
                        className="workspace-template-main"
                        onClick={() => {
                          setSelectedWorkspaceTemplateId(item.id)
                          setWorkspaceTemplateName(item.name)
                        }}
                        disabled={isWorkspaceBusy}
                      >
                        <span className="workspace-template-icon"><Layers3 size={16} /></span>
                        <span>
                          <b>{item.name}</b>
                          <small>
                            {item.assetCount} 个素材 · {item.rows} × {item.columns} · {formatBytes(item.byteSize)}
                          </small>
                        </span>
                        <time>{formatWorkspaceDate(item.updatedAt)}</time>
                      </button>
                      <button
                        className="workspace-template-delete"
                        title="删除工作空间模板"
                        onClick={() => void removeWorkspaceTemplate(item.id)}
                        disabled={isWorkspaceBusy}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="workspace-template-empty">
                    <Layers3 size={24} />
                    <span>还没有工作空间模板</span>
                    <small>保存后可快速恢复当前全部内容</small>
                  </div>
                )}
              </div>
            </div>

            <footer>
              <span className="workspace-selected-summary">
                {selectedWorkspaceTemplate
                  ? `将恢复：${selectedWorkspaceTemplate.name}`
                  : '请选择需要恢复的模板'}
              </span>
              <button
                className="primary-button workspace-restore-button"
                onClick={() => void restoreWorkspaceTemplate()}
                disabled={!selectedWorkspaceTemplate || isWorkspaceBusy}
              >
                {isWorkspaceBusy ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}
                恢复工作空间
              </button>
            </footer>
          </section>
        </div>
      )}

      {toast && <div className="toast"><Check size={15} /> {toast}</div>}
    </div>
  )
}
