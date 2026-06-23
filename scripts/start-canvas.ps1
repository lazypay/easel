#!/usr/bin/env pwsh
param([string]$ProjectDir)

$ErrorActionPreference = "Stop"

# Plugin root is the parent of this scripts/ directory.
$RootDir = Split-Path -Parent $PSScriptRoot
$CallerDir = (Get-Location).Path
$Port = if ($env:EASEL_PORT) { $env:EASEL_PORT } else { "43219" }

if ($env:EASEL_PROJECT_DIR) {
  $ProjectDir = $env:EASEL_PROJECT_DIR
} elseif (-not $ProjectDir) {
  $ProjectDir = $CallerDir
}
$CanvasDir = if ($env:EASEL_CANVAS_DIR) { $env:EASEL_CANVAS_DIR } else { Join-Path $ProjectDir "canvas" }

$env:EASEL_PROJECT_DIR = $ProjectDir
$env:EASEL_CANVAS_DIR = $CanvasDir

Set-Location $RootDir

if (-not (Test-Path "node_modules")) {
  npm install
}

Write-Output "Easel canvas: http://127.0.0.1:$Port"
Write-Output "Easel canvas data: $CanvasDir\pages\<page-id>\"
Write-Output "Easel page assets: $CanvasDir\pages\<page-id>\assets -> http://127.0.0.1:$Port/page-assets/<page-id>/"

npm run dev -- --host 127.0.0.1 --port $Port
