const QRCode = require('qrcode');
const sharp = require('sharp');

// Validation des couleurs hexadécimales
const isValidHexColor = (color) => /^#([0-9A-Fa-f]{3}){1,2}$/.test(color);

// Validation URL sécurisée (protection SSRF)
const isValidLogoUrl = (url) => {
    try {
        const parsed = new URL(url);
        // Seulement HTTPS autorisé
        if (parsed.protocol !== 'https:') return false;
        // Bloquer localhost et IPs privées
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
        if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) return false;
        if (hostname.startsWith('172.') && parseInt(hostname.split('.')[1]) >= 16 && parseInt(hostname.split('.')[1]) <= 31) return false;
        return true;
    } catch {
        return false;
    }
};

// Créer un masque SVG arrondi
const createRoundedMask = (size, radius) => {
    return Buffer.from(`
        <svg width="${size}" height="${size}">
            <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
        </svg>
    `);
};

/**
 * Serverless function pour générer des QR Codes stylisés
 * 
 * Query params:
 * - url (required): URL à encoder dans le QR code
 * - color (optional): Couleur hex du QR (default: #000000)
 * - logo (optional): URL HTTPS d'un logo à incruster au centre (max 500KB)
 * - size (optional): Taille en pixels (default: 400, max: 1200)
 * - bgColor (optional): Couleur de fond hex (default: #ffffff)
 * - download (optional): Si 'true', télécharge le fichier au lieu de l'afficher
 */
module.exports = async function handler(req, res) {
    try {
        // Récupérer les paramètres
        const { url, color = '#000000', logo, size = '400', bgColor = '#ffffff', download } = req.query;

        // Validation URL
        if (!url) {
            res.status(400).json({ error: 'Le paramètre "url" est obligatoire' });
            return;
        }

        // Validation couleurs hex
        if (!isValidHexColor(color)) {
            res.status(400).json({ error: 'La couleur doit être au format hex (#RGB ou #RRGGBB)' });
            return;
        }
        if (!isValidHexColor(bgColor)) {
            res.status(400).json({ error: 'La couleur de fond doit être au format hex (#RGB ou #RRGGBB)' });
            return;
        }

        // Validation taille (limité à 1200 pour performance Vercel)
        const qrSize = parseInt(size, 10);
        if (isNaN(qrSize) || qrSize < 100 || qrSize > 1200) {
            res.status(400).json({ error: 'La taille doit être entre 100 et 1200 pixels' });
            return;
        }

        // Générer le QR Code avec correction d'erreur High (obligatoire pour les logos)
        const qrBuffer = await QRCode.toBuffer(url, {
            errorCorrectionLevel: 'H',
            width: qrSize,
            margin: 2,
            color: {
                dark: color,
                light: bgColor
            }
        });

        let finalBuffer = qrBuffer;

        // Si un logo est fourni, l'incruster au centre
        if (logo) {
            try {
                // Validation SSRF : seulement HTTPS et pas d'IPs privées
                if (!isValidLogoUrl(logo)) {
                    throw new Error('Le logo doit être une URL HTTPS valide (pas d\'IP locale)');
                }

                // Télécharger le logo avec limite de taille
                const logoResponse = await fetch(logo);
                if (!logoResponse.ok) {
                    throw new Error('Impossible de télécharger le logo');
                }

                // Vérifier la taille du logo (max 500KB)
                const contentLength = logoResponse.headers.get('content-length');
                if (contentLength && parseInt(contentLength) > 500 * 1024) {
                    throw new Error('Le logo est trop volumineux (max 500KB)');
                }

                const logoArrayBuffer = await logoResponse.arrayBuffer();

                // Double vérification de la taille
                if (logoArrayBuffer.byteLength > 500 * 1024) {
                    throw new Error('Le logo est trop volumineux (max 500KB)');
                }

                const logoBuffer = Buffer.from(logoArrayBuffer);

                // Calculer la taille du logo (22% de la taille du QR)
                const logoSize = Math.floor(qrSize * 0.22);

                // Redimensionner le logo
                const resizedLogo = await sharp(logoBuffer)
                    .resize(logoSize, logoSize, {
                        fit: 'contain',
                        background: { r: 255, g: 255, b: 255, alpha: 0 }
                    })
                    .toBuffer();

                // Calculer la position centrale
                const position = Math.floor((qrSize - logoSize) / 2);

                // Créer un fond blanc vraiment arrondi pour le logo
                const logoBackgroundSize = Math.floor(logoSize * 1.15);
                const logoBackgroundPosition = Math.floor((qrSize - logoBackgroundSize) / 2);
                const borderRadius = Math.floor(logoBackgroundSize * 0.15); // 15% de rayon

                // Créer le fond blanc
                const whiteBackground = await sharp({
                    create: {
                        width: logoBackgroundSize,
                        height: logoBackgroundSize,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                    }
                })
                    .png()
                    .toBuffer();

                // Appliquer le masque arrondi pour obtenir un vrai fond arrondi
                const roundedBackground = await sharp(whiteBackground)
                    .composite([{
                        input: createRoundedMask(logoBackgroundSize, borderRadius),
                        blend: 'dest-in'
                    }])
                    .png()
                    .toBuffer();

                // Composer l'image finale : QR + fond blanc + logo
                finalBuffer = await sharp(qrBuffer)
                    .composite([
                        {
                            input: roundedBackground,
                            top: logoBackgroundPosition,
                            left: logoBackgroundPosition
                        },
                        {
                            input: resizedLogo,
                            top: position,
                            left: position
                        }
                    ])
                    .png()
                    .toBuffer();

            } catch (logoError) {
                console.error('Erreur logo:', logoError.message);
                // On continue sans le logo si ça échoue
            }
        }

        // Retourner l'image PNG
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');

        // Si download=true, forcer le téléchargement
        if (download === 'true') {
            res.setHeader('Content-Disposition', 'attachment; filename="qrcode.png"');
        }

        res.status(200).end(finalBuffer);

    } catch (error) {
        console.error('Erreur génération QR:', error);
        res.status(500).json({ error: 'Erreur lors de la génération du QR Code' });
    }
};
