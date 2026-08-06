# Remoter

<p align="center">
  <b>一个现代化、跨平台的极速 SSH 与服务器管理客户端。</b>
</p>

## ✨ 简介

Remoter 是一款基于 **Tauri v2** 与 **React 19** 构建的高性能跨平台桌面 SSH 客户端。它摒弃了传统工具的臃肿，通过极致流畅的终端交互、批量命令分发以及与终端深度集成的 SFTP 文件管理功能，为您提供一体化的服务器运维体验。

## 🚀 核心特性

- **💻 极致流畅的 SSH 终端**
  - 基于 xterm.js 构建，支持透明背景、深色模式与自适应尺寸，内置 JetBrains Mono 字体。
  - 独有三阶段状态机，有效过滤启动噪音，带来清爽的连接体验。
  - 支持密码及 SSH 密钥认证，意外断线支持快捷重连。
  - 支持多标签页，从容管理多个会话。

- **⚡ 批量命令与文件分发 (一键多控)**
  - 支持主机分组、拖拽排序管理。
  - 批量选中多台服务器，利用 Rust 底层并发优势，极速分发执行命令与文件。
  - 直观的可视化状态看板 (Idle / Running / Success / Failure)。

- **📁 丝滑的 SFTP 文件抽屉**
  - 创新性的“从顶部滑出”抽屉式设计（由 Framer Motion 驱动），操作文件时不打断终端操作心流。
  - Shell 深度集成，通过 OSC 7 钩子实时同步并跟随终端当前工作目录。
  - 支持全套文件操作：浏览、新建、重命名、删除、上传、下载。
  - 支持系统级别的原生文件拖拽上传。

- **🛠️ 快捷自动化脚本**
  - 预设命令模板，支持 `$var_name` 变量注入及运行前参数弹窗确认。
  - 支持单台机器独立执行或多机批量下发。

## 🛠 技术架构

得益于经典的前后端分离与内存安全的并发设计，Remoter 兼顾了漂亮的 UI 与极速的性能：

- **核心与引擎 (Rust)**: Tauri v2, tokio (高并发), ssh2, DashMap (无锁状态管理)
- **用户界面 (React)**: React 19, TypeScript, Vite 7, TailwindCSS v4, shadcn/ui
- **动画与交互**: Framer Motion

## 📦 本地开发指南

### 环境准备
- Node.js (建议 v20+)
- pnpm 
- Rust (建议最新 Stable)

### 快速启动

```bash
# 1. 克隆项目
git clone https://github.com/your-name/remoter.git
cd remoter

# 2. 安装前端依赖
pnpm install

# 3. 运行开发环境
pnpm dev
```

### 发布新版本

发布脚本要求工作区干净，并会依次检查远端状态、扫描密钥、运行已有测试及生产构建，随后同步版本号、创建提交和 `v*` 标签，最后以原子方式推送分支与标签。

```bash
pnpm publish:new          # 默认递增 patch，例如 0.1.6 -> 0.1.7
pnpm publish:new minor    # 递增 minor
pnpm publish:new major    # 递增 major
pnpm publish:new 1.0.0    # 指定版本
```

如系统已安装 [gitleaks](https://github.com/gitleaks/gitleaks)，脚本会优先使用它；否则使用内置规则扫描已跟踪文件。

## 📖 详细文档

想要深入了解此项目的核心逻辑与设计规范，请查阅我们的内部架构文档：
- [项目概述](./.agent/docs/overview.md)
- [功能列表](./.agent/docs/features.md)
- [架构与代码规范](./.agent/docs/conventions.md)
- [视觉设计](./.agent/docs/design.md)

## 📄 许可证

本项目遵循 MIT 开源许可证。
