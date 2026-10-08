# 把品红底的像素图标收成透明 PNG，并按原始像素网格取样，去掉 JPEG 毛边。
# 用法: powershell -File tools/bake-icons.ps1 <源目录> <输出目录>
param(
  [string]$Src = "$env:USERPROFILE\.cursor\projects\e-Webgame2\assets",
  [string]$Dst = (Join-Path (Split-Path $PSScriptRoot -Parent) "assets\icons")
)

Add-Type -AssemblyName System.Drawing

$srcCode = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public static class IconBake {
  static bool IsMagenta(int r, int g, int b) {
    /* 生图的品红底并不纯：有的偏 #FF00FF，有的是 JPEG 压出来的亮粉。 */
    return r > 210 && g < 45 && b > 120;
  }

  static int Uniformity(Bitmap bmp, int s) {
    int good = 0, total = 0;
    int w = bmp.Width;
    for (int by = 0; by + s <= w; by += s) {
      for (int bx = 0; bx + s <= w; bx += s) {
        int cx = bx + s / 2, cy = by + s / 2;
        Color mid = bmp.GetPixel(cx, cy);
        if (IsMagenta(mid.R, mid.G, mid.B)) continue;
        Color a = bmp.GetPixel(bx + s / 4, by + s / 4);
        Color c = bmp.GetPixel(bx + (s * 3) / 4, by + (s * 3) / 4);
        int d = Math.Abs(a.R - mid.R) + Math.Abs(a.G - mid.G) + Math.Abs(a.B - mid.B)
              + Math.Abs(c.R - mid.R) + Math.Abs(c.G - mid.G) + Math.Abs(c.B - mid.B);
        total++;
        if (d < 48) good++;
      }
    }
    if (total < 8) return 0;
    return good * 1000 / total;
  }

  public static string Bake(string srcPath, string dstPath) {
    using (var raw = new Bitmap(srcPath)) {
      int s = 16;
      int best = 0;
      string scores = "";
      int[] cands = new int[] { 64, 32, 16, 8 };
      foreach (int cand in cands) {
        if (raw.Width % cand != 0) continue;
        int score = Uniformity(raw, cand);
        scores += cand + ":" + score + " ";
        if (score >= 860 && cand > best) { best = cand; s = cand; }
      }
      int n = raw.Width / s;
      int outN = 64;
      int cell = outN / n;
      if (n > outN || outN % n != 0) { outN = n; cell = 1; }
      using (var dst = new Bitmap(outN, outN, PixelFormat.Format32bppArgb)) {
        for (int y = 0; y < n; y++) {
          for (int x = 0; x < n; x++) {
            Color c = raw.GetPixel(x * s + s / 2, y * s + s / 2);
            Color paint = IsMagenta(c.R, c.G, c.B) ? Color.Transparent : Color.FromArgb(255, c.R, c.G, c.B);
            for (int dy = 0; dy < cell; dy++) {
              for (int dx = 0; dx < cell; dx++) dst.SetPixel(x * cell + dx, y * cell + dy, paint);
            }
          }
        }
        dst.Save(dstPath, ImageFormat.Png);
      }
      return s + " -> " + outN + "  [" + scores.Trim() + "]";
    }
  }
}
'@

Add-Type -TypeDefinition $srcCode -ReferencedAssemblies System.Drawing
New-Item -ItemType Directory -Force -Path $Dst | Out-Null

Get-ChildItem -Path $Src -Filter "icon-*.jpg" | ForEach-Object {
  $name = $_.BaseName + ".png"
  $out = Join-Path $Dst $name
  $info = [IconBake]::Bake($_.FullName, $out)
  Write-Output ("{0}  {1}" -f $name, $info)
}
