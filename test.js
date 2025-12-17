// Script de test local
const fs = require('fs');
const path = require('path');

// Mock de req/res pour simuler Vercel
const mockReq = {
    query: {
        url: 'https://google.com',
        color: '#6366f1', // Violet
        size: '400'
    }
};

let responseBuffer = null;
const mockRes = {
    setHeader: (name, value) => console.log(`Header: ${name} = ${value}`),
    status: (code) => ({
        json: (data) => console.log('Response:', code, data),
        end: (buffer) => {
            responseBuffer = buffer;
            console.log(`✅ QR Code généré! Taille: ${buffer.length} bytes`);
        }
    })
};

// Import et test
const generate = require('./api/generate');

generate(mockReq, mockRes).then(() => {
    if (responseBuffer) {
        const outputPath = path.join(__dirname, 'test-qr.png');
        fs.writeFileSync(outputPath, responseBuffer);
        console.log(`📁 Fichier sauvegardé: ${outputPath}`);
    }
}).catch(console.error);
