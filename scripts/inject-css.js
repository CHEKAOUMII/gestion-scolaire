const fs = require('fs');
const path = require('path');

const directory = '.';
const cssToInject = '    <link rel="stylesheet" href="css/design-system.css">';
const targetLine = '<link rel="stylesheet" href="styles.css">';

function processDirectory(dir) {
    fs.readdir(dir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(dir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error stating file:', err);
                    return;
                }

                if (stats.isDirectory() && file !== 'node_modules' && file !== '.git') {
                    // Recurse into subdirectories (though mostly likely everything is in root)
                    // processDirectory(filePath); 
                } else if (path.extname(file) === '.html') {
                    injectCss(filePath);
                }
            });
        });
    });
}

function injectCss(filePath) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error(`Error reading file ${filePath}:`, err);
            return;
        }

        if (data.includes('css/design-system.css')) {
            console.log(`Skipping ${filePath}: CSS already injected.`);
            return;
        }

        if (data.includes(targetLine)) {
            const newData = data.replace(targetLine, `${cssToInject}\n    ${targetLine}`);
            fs.writeFile(filePath, newData, 'utf8', (err) => {
                if (err) {
                    console.error(`Error writing file ${filePath}:`, err);
                } else {
                    console.log(`Updated ${filePath}`);
                }
            });
        } else {
            console.log(`Skipping ${filePath}: styles.css not found.`);
        }
    });
}

processDirectory(directory);
