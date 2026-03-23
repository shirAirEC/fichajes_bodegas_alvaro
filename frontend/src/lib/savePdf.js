import { Capacitor } from '@capacitor/core';

/**
 * Guarda un PDF generado con jsPDF.
 * - En web: descarga normal con doc.save()
 * - En móvil (Capacitor): escribe en el directorio de Descargas y comparte el fichero
 *   para que el usuario pueda abrirlo con el visor que prefiera.
 *
 * @param {import('jspdf').jsPDF} doc  Instancia de jsPDF ya construida
 * @param {string} filename  Nombre del fichero con extensión .pdf
 */
export async function savePdf(doc, filename) {
  if (!Capacitor.isNativePlatform()) {
    doc.save(filename);
    return;
  }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    const base64 = doc.output('datauristring').split(',')[1];

    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });

    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: 'Abrir o compartir PDF',
    });
  } catch (err) {
    console.error('savePdf mobile error:', err);
    // Fallback: intentar descarga web
    doc.save(filename);
  }
}
