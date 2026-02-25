/**
 * Script to restore corrupted Arabic text in HTML files.
 * 
 * Strategy: For each corrupted file in the working copy, read the corresponding
 * clean version from git (v1.0.8 tag), then line-by-line compare and replace
 * lines that differ only by having ???? instead of Arabic text.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get list of HTML files with corruption
const corruptedFiles = [
    'absence-analytics.html',
    'absence-correspondence.html',
    'absence-students.html',
    'absence-weekly.html',
    'analytics.html',
    'communication-center-prototype.html',
    'exams-proctors.html',
    'exams-rooms.html',
    'exams-schedule.html',
    'exams-tests.html',
    'grades-sheets.html',
    'index.html',
    'reports-certificates.html',
    'reports-forms.html',
    'reports-semester.html',
    'settings-imports.html',
    'settings-logs.html',
    'settings-school.html',
    'settings-users.html',
    'student-profile-prototype.html',
    'students-files.html',
    'students-movement.html',
    'students-register.html',
    'teachers-absence.html',
    'teachers-list.html',
    'teachers-schedule.html',
    'timetable-rooms.html',
    'timetable-students.html',
];

const CLEAN_COMMIT = '052115b'; // v1.0.8 tag - has correct Arabic

function getCleanFile(filename) {
    try {
        return execSync(`git show ${CLEAN_COMMIT}:${filename}`, {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024
        });
    } catch (e) {
        // File might not exist in that commit
        return null;
    }
}

// Extract only the non-CSS, non-JS text parts that contain question marks
// Strategy: For each line in the working file that has ?????,
// find a matching line in the clean file by comparing the HTML structure (tags, attributes)
// minus the text content.
function getStructuralSignature(line) {
    // Remove all text content, keep only HTML tags and attributes structure
    // Replace sequences of ?'s with a placeholder
    return line
        .replace(/\?{2,}/g, '<<TEXT>>')
        .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, '<<TEXT>>')
        .replace(/<<TEXT>>(\s*<<TEXT>>)*/g, '<<TEXT>>')
        .trim();
}

let totalFixed = 0;
let totalFiles = 0;

for (const filename of corruptedFiles) {
    const workingPath = path.join('.', filename);

    if (!fs.existsSync(workingPath)) {
        console.log(`SKIP: ${filename} does not exist in working directory`);
        continue;
    }

    const cleanContent = getCleanFile(filename);
    if (!cleanContent) {
        console.log(`SKIP: ${filename} does not exist in clean commit`);
        continue;
    }

    const workingContent = fs.readFileSync(workingPath, 'utf8');

    // Check if working file has corruption
    if (!workingContent.includes('?????')) {
        console.log(`OK: ${filename} has no corruption`);
        continue;
    }

    const workingLines = workingContent.split('\n');
    const cleanLines = cleanContent.split('\n');

    // Build a map of structural signatures from clean file
    const cleanMap = new Map();
    for (let i = 0; i < cleanLines.length; i++) {
        const sig = getStructuralSignature(cleanLines[i]);
        if (sig.includes('<<TEXT>>')) {
            if (!cleanMap.has(sig)) {
                cleanMap.set(sig, []);
            }
            cleanMap.get(sig).push({ index: i, line: cleanLines[i] });
        }
    }

    let fixCount = 0;
    const usedCleanLines = new Set();

    for (let i = 0; i < workingLines.length; i++) {
        const line = workingLines[i];

        // Only process lines with ?????
        if (!line.includes('?????')) continue;

        const sig = getStructuralSignature(line);
        const candidates = cleanMap.get(sig);

        if (candidates && candidates.length > 0) {
            // Find the best matching candidate that hasn't been used
            let bestMatch = null;
            for (const candidate of candidates) {
                if (!usedCleanLines.has(candidate.index)) {
                    bestMatch = candidate;
                    break;
                }
            }

            if (bestMatch) {
                // Replace the corrupted line with the clean line, preserving leading whitespace
                const leadingWhitespace = line.match(/^(\s*)/)[1];
                const cleanLeading = bestMatch.line.match(/^(\s*)/)[1];

                // Use clean line's content but with working line's indentation
                workingLines[i] = leadingWhitespace + bestMatch.line.trim();
                usedCleanLines.add(bestMatch.index);
                fixCount++;
            } else {
                console.log(`  WARN: No unused match for line ${i + 1} in ${filename}: ${line.trim().substring(0, 80)}`);
            }
        } else {
            // No structural match found - this line was added/modified after the clean commit
            // Try a more relaxed matching approach
            console.log(`  WARN: No match for line ${i + 1} in ${filename}: ${line.trim().substring(0, 80)}`);
        }
    }

    if (fixCount > 0) {
        fs.writeFileSync(workingPath, workingLines.join('\n'), 'utf8');
        console.log(`FIXED: ${filename} - ${fixCount} lines restored`);
        totalFixed += fixCount;
        totalFiles++;
    } else {
        console.log(`SKIP: ${filename} - no fixable lines found`);
    }
}

console.log(`\nDone! Fixed ${totalFixed} lines in ${totalFiles} files.`);
