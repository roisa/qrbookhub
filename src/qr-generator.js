import QRCodeStyling from 'qr-code-styling';

export function createQr({ data, size = 300, margin = 10, ecc = 'M' }) {
  return new QRCodeStyling({
    width: size,
    height: size,
    type: 'svg',
    data,
    margin,
    qrOptions: {
      errorCorrectionLevel: ecc,
    },
    dotsOptions: {
      color: '#0b1020',
      type: 'rounded',
    },
    backgroundOptions: {
      color: '#ffffff',
    },
    cornersSquareOptions: {
      color: '#4f46e5',
      type: 'extra-rounded',
    },
    cornersDotOptions: {
      color: '#4f46e5',
      type: 'dot',
    },
  });
}

export async function qrToBlob(qr, ext = 'png') {
  const blob = await qr.getRawData(ext);
  if (!blob) throw new Error('Failed to render QR');
  if (blob instanceof Blob) return blob;
  return new Blob([blob], { type: ext === 'svg' ? 'image/svg+xml' : `image/${ext}` });
}
