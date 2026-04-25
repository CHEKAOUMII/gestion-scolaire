# Replace hardcoded old-palette colors across CSS and HTML files
$targets = @(
    'd:\project 06\styles.css',
    'd:\project 06\ux-enhancements.css',
    'd:\project 06\timetable.html',
    'd:\project 06\absence-analytics.html',
    'd:\project 06\communication-center-prototype.html',
    'd:\project 06\student-profile-prototype.html'
)

$replacements = @{
    # Teal rgba(0, 131, 143, X) -> Pine Green rgba(45, 95, 74, X)
    'rgba(0, 131, 143, 0.05)' = 'rgba(45, 95, 74, 0.05)'
    'rgba(0, 131, 143, 0.08)' = 'rgba(45, 95, 74, 0.06)'
    'rgba(0, 131, 143, 0.1)' = 'rgba(45, 95, 74, 0.08)'
    'rgba(0, 131, 143, 0.15)' = 'rgba(45, 95, 74, 0.1)'
    'rgba(0, 131, 143, 0.2)' = 'rgba(45, 95, 74, 0.15)'
    'rgba(0, 131, 143, 0.3)' = 'rgba(45, 95, 74, 0.2)'
    'rgba(0, 131, 143, 0.4)' = 'rgba(45, 95, 74, 0.3)'
    'rgba(0, 131, 143, 0.5)' = 'rgba(45, 95, 74, 0.4)'
    # Old Sage Green rgba(141, 163, 153, X) -> Pine Green rgba(45, 95, 74, X)
    'rgba(141, 163, 153, 0.15)' = 'rgba(45, 95, 74, 0.1)'
    'rgba(141, 163, 153, 0.2)' = 'rgba(45, 95, 74, 0.15)'
    'rgba(141, 163, 153, 0.4)' = 'rgba(45, 95, 74, 0.3)'
    'rgba(141, 163, 153, 0.5)' = 'rgba(45, 95, 74, 0.4)'
    # Hardcoded hex #8DA399 -> #2D5F4A
    '#8DA399' = '#2D5F4A'
    '#6B8278' = '#1B3D30'
    '#B4C5BD' = '#4A8B6F'
    '#00838f' = '#2D5F4A'
}

foreach ($file in $targets) {
    if (Test-Path $file) {
        $content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
        $changed = $false
        foreach ($key in $replacements.Keys) {
            if ($content.Contains($key)) {
                $content = $content.Replace($key, $replacements[$key])
                $changed = $true
            }
        }
        if ($changed) {
            [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
            Write-Output "Replaced colors in: $(Split-Path $file -Leaf)"
        } else {
            Write-Output "No changes needed: $(Split-Path $file -Leaf)"
        }
    }
}
Write-Output "Done."
