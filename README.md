# Picture Array

Picture Array 是一个面向论文实验结果对比图的浏览器端排版工具，适合整理同一数据集在不同模型下的可视化结果。项目使用 React、TypeScript 和 Vite 构建，图片预处理、排版、工作空间保存与导出均在浏览器本地完成。

## 功能

- **素材管理**：批量导入 PNG、JPG、JPEG 和 WebP 图片，支持拖放、双击填充、重命名和移除。
- **无损预处理**：保持图片真实宽高比，通过拖动四角或输入 X/Y/W/H 完成裁剪；处理结果作为新 PNG 素材加入素材库，原图不会被覆盖。
- **裁剪模板**：保存、调用和删除常用裁剪范围，可生成当前素材或批量生成全部素材。
- **自由图阵**：设置任意行列、间距、画布宽度、页面边距和原图缩放比例。
- **行列标签**：列标签位于底部，行标签位于左侧并旋转 90°；支持 LaTeX、字号、粗体、斜体和位置调整。
- **统一局部放大**：为全部行统一添加 1–4 张正方形局部图，默认两张。ROI 在同一行的不同模型结果之间保持一致，原图尺寸不会因增加局部图而缩小。
- **边框配色**：自定义局部图的主、次边框颜色，并同步应用到原图 ROI、局部图和矢量 PDF。
- **工作空间模板**：使用 IndexedDB 保存完整项目快照，包括素材、裁剪、布局、标签、画布和局部放大设置。
- **论文级导出**：按画布真实尺寸导出 PDF 或高清 PNG。PDF 中的标签、边框、ROI 和 LaTeX 公式保持矢量，原始图片以位图嵌入。

## 快速开始

环境要求：Node.js 18 或更高版本，以及 npm。

```bash
git clone https://github.com/JoyceWil/Picture-Array.git
cd Picture-Array
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`。

Windows PowerShell 中也可以使用：

```powershell
npm.cmd install
npm.cmd run dev
```

## 基本工作流

1. 将实验结果图片批量导入素材库。
2. 如原图包含多个子图，在预处理区域裁剪并将结果生成为新素材。
3. 设置图阵的行列数量，将素材拖入对应单元格。
4. 编辑行列标签、画布尺寸和图片间距。
5. 开启统一局部放大，在任意一行定位 ROI，并选择主、次边框颜色。
6. 保存本地工作空间，或导出 PDF / PNG 成图。

## 构建与预览

```bash
npm run build
npm run preview
```

生产文件输出到 `dist/`。项目是纯前端应用，可将 `dist/` 直接部署到 Nginx、Apache、GitHub Pages 或其他静态托管服务。

## 数据与隐私

- 图片处理和排版都在浏览器本地执行，项目不会主动上传素材到服务器。
- 草稿使用 localStorage 保存；裁剪模板和工作空间模板使用 IndexedDB 保存。
- 浏览器数据按域名、浏览器和设备隔离，清除网站数据会删除本地模板。
- 工作空间模板包含图片数据，数量和大小受浏览器存储配额限制。
- “导出项目配置”生成的是布局配置 JSON，不包含原始图片二进制，不能单独作为跨设备完整备份。

## 导出说明

| 格式 | 说明 |
| --- | --- |
| PDF | 自定义画布尺寸；文字、标签、边框、ROI 和 LaTeX 公式保持矢量，图片以原始位图嵌入。 |
| PNG | 支持 2× 和 3× 清晰度，仅导出中间白色画布。 |
| 系统打印 | 备用 PDF 入口，纸张尺寸由浏览器打印设置决定。 |

## 技术栈

- React 18
- TypeScript 5
- Vite 6
- KaTeX / MathJax
- jsPDF / svg2pdf.js
- html-to-image
- IndexedDB

## 项目结构

```text
picture_array/
├─ src/
│  ├─ App.tsx          # 主界面、图阵、预处理与工作空间逻辑
│  ├─ styles.css       # 页面与画布样式
│  ├─ pdfExport.ts     # 自定义尺寸矢量 PDF 导出
│  ├─ workspaceDb.ts   # IndexedDB 工作空间存储
│  └─ main.tsx         # 应用入口
├─ public/             # 静态资源
├─ index.html
├─ package.json
└─ vite.config.ts
```

## npm 命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器。 |
| `npm run build` | 执行 TypeScript 检查并生成生产文件。 |
| `npm run preview` | 本地预览生产构建。 |

