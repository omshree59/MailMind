Add-Type -AssemblyName System.Drawing

function Create-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2.0
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Create-SparklePath([float]$cx, [float]$cy, [float]$radius, [float]$inner) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $points = @(
        (New-Object System.Drawing.PointF ($cx, ($cy - $radius))),
        (New-Object System.Drawing.PointF (($cx + $inner), ($cy - $inner))),
        (New-Object System.Drawing.PointF (($cx + $radius), $cy)),
        (New-Object System.Drawing.PointF (($cx + $inner), ($cy + $inner))),
        (New-Object System.Drawing.PointF ($cx, ($cy + $radius))),
        (New-Object System.Drawing.PointF (($cx - $inner), ($cy + $inner))),
        (New-Object System.Drawing.PointF (($cx - $radius), $cy)),
        (New-Object System.Drawing.PointF (($cx - $inner), ($cy - $inner)))
    )
    $path.AddPolygon($points)
    return $path
}

function Render-MailMindIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 256.0

    # 1. Background squircle
    $pad = 12.0 * $scale
    $sqW = $size - (2.0 * $pad)
    $sqH = $size - (2.0 * $pad)
    $sqR = 48.0 * $scale
    $bgPath = Create-RoundedRectPath $pad $pad $sqW $sqH $sqR

    # Shadow / glow under squircle
    $glowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 16, 185, 129))
    $glowPen = New-Object System.Drawing.Pen $glowBrush, (8.0 * $scale)
    $g.DrawPath($glowPen, $bgPath)
    $glowPen.Dispose()
    $glowBrush.Dispose()

    # Dark background gradient: #111115 to #09090B
    $rect = New-Object System.Drawing.RectangleF $pad, $pad, $sqW, $sqH
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush ($rect, [System.Drawing.Color]::FromArgb(255, 24, 24, 30), [System.Drawing.Color]::FromArgb(255, 10, 10, 13), 60.0)
    $g.FillPath($bgBrush, $bgPath)
    $bgBrush.Dispose()

    # Subtle inner border (#27272A and top accent shine)
    $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 52, 211, 153)), (2.5 * $scale)
    $g.DrawPath($borderPen, $bgPath)
    $borderPen.Dispose()

    # 2. Envelope design
    # Envelope geometry (centered)
    $envX = 52.0 * $scale
    $envY = 72.0 * $scale
    $envW = 152.0 * $scale
    $envH = 112.0 * $scale
    $envR = 14.0 * $scale

    $envPath = Create-RoundedRectPath $envX $envY $envW $envH $envR

    # Mail card back/fill: dark emerald gradient
    $envBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.PointF ($envX, $envY)),
        (New-Object System.Drawing.PointF (($envX + $envW), ($envY + $envH))),
        [System.Drawing.Color]::FromArgb(255, 16, 78, 55),
        [System.Drawing.Color]::FromArgb(255, 9, 45, 32)
    )
    $g.FillPath($envBrush, $envPath)
    $envBrush.Dispose()

    # Mail border
    $envPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 16, 185, 129)), (1.5 * $scale)
    $g.DrawPath($envPen, $envPath)
    $envPen.Dispose()

    # Envelope Flap / V-fold
    # Top flap (folded down)
    $flapPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $ptL = New-Object System.Drawing.PointF (($envX + 6.0 * $scale), ($envY + 6.0 * $scale))
    $ptR = New-Object System.Drawing.PointF (($envX + $envW - 6.0 * $scale), ($envY + 6.0 * $scale))
    $ptM = New-Object System.Drawing.PointF (($envX + $envW / 2.0), ($envY + $envH * 0.58))
    
    $flapPath.AddLine($ptL, $ptM)
    $flapPath.AddLine($ptM, $ptR)
    
    $foldPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(240, 52, 211, 153)), (3.5 * $scale)
    $foldPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $foldPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $foldPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($foldPen, $flapPath)
    $foldPen.Dispose()
    $flapPath.Dispose()

    # Lower folds (subtle)
    $botL = New-Object System.Drawing.PointF (($envX + 8.0 * $scale), ($envY + $envH - 6.0 * $scale))
    $botR = New-Object System.Drawing.PointF (($envX + $envW - 8.0 * $scale), ($envY + $envH - 6.0 * $scale))
    $subPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 52, 211, 153)), (2.0 * $scale)
    $g.DrawLine($subPen, $botL, (New-Object System.Drawing.PointF (($envX + $envW * 0.4), ($envY + $envH * 0.52))))
    $g.DrawLine($subPen, $botR, (New-Object System.Drawing.PointF (($envX + $envW * 0.6), ($envY + $envH * 0.52))))
    $subPen.Dispose()

    # 3. AI Neural Sparkle (Brilliant glowing 4-point star in top-right)
    $spX = 188.0 * $scale
    $spY = 66.0 * $scale
    $spRadius = 30.0 * $scale
    $spInner = 7.0 * $scale

    # Sparkle glow
    $glowCircle = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 16, 185, 129))
    $g.FillEllipse($glowCircle, ($spX - $spRadius * 1.3), ($spY - $spRadius * 1.3), ($spRadius * 2.6), ($spRadius * 2.6))
    $glowCircle.Dispose()

    $sparklePath = Create-SparklePath $spX $spY $spRadius $spInner
    $sparkleBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.PointF (($spX - $spRadius), ($spY - $spRadius))),
        (New-Object System.Drawing.PointF (($spX + $spRadius), ($spY + $spRadius))),
        [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(255, 52, 211, 153)
    )
    $g.FillPath($sparkleBrush, $sparklePath)
    $sparkleBrush.Dispose()
    $sparklePath.Dispose()

    # Secondary tiny sparkle
    $sp2X = 208.0 * $scale
    $sp2Y = 104.0 * $scale
    $sp2Radius = 14.0 * $scale
    $sp2Inner = 3.5 * $scale
    $sparkle2Path = Create-SparklePath $sp2X $sp2Y $sp2Radius $sp2Inner
    $sp2Brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 167, 243, 208))
    $g.FillPath($sp2Brush, $sparkle2Path)
    $sp2Brush.Dispose()
    $sparkle2Path.Dispose()

    $bgPath.Dispose()
    $envPath.Dispose()
    $g.Dispose()

    return $bmp
}

$sizes = @(256, 128, 64, 48, 32, 16)
$pngStreams = @()

foreach ($sz in $sizes) {
    $bmp = Render-MailMindIcon $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams += ,@($sz, $ms.ToArray())
    if ($sz -eq 256) {
        $bmp.Save("public\app-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host "Saved public\app-icon.png (256x256)"
    }
    $ms.Dispose()
    $bmp.Dispose()
}

# Write multi-resolution .ico file
$icoStream = New-Object System.IO.FileStream "app.ico", ([System.IO.FileMode]::Create), ([System.IO.FileAccess]::Write)
$bw = New-Object System.IO.BinaryWriter $icoStream

# Header
$bw.Write([UInt16]0) # Reserved
$bw.Write([UInt16]1) # Icon
$bw.Write([UInt16]$sizes.Count) # Count of images

$offset = 6 + (16 * $sizes.Count)

# Directory entries
foreach ($item in $pngStreams) {
    $sz = $item[0]
    $data = $item[1]
    
    $bw.Write([byte]($sz -band 0xFF)) # Width (0 = 256)
    $bw.Write([byte]($sz -band 0xFF)) # Height (0 = 256)
    $bw.Write([byte]0)                # Color count
    $bw.Write([byte]0)                # Reserved
    $bw.Write([UInt16]1)              # Color planes
    $bw.Write([UInt16]32)             # Bits per pixel
    $bw.Write([UInt32]$data.Length)   # Size of image data
    $bw.Write([UInt32]$offset)        # Image offset
    
    $offset += $data.Length
}

# Image Data
foreach ($item in $pngStreams) {
    $data = $item[1]
    $bw.Write($data)
}

$bw.Flush()
$icoStream.Close()
$bw.Dispose()
$icoStream.Dispose()

Write-Host "Successfully generated multi-resolution app.ico!"
