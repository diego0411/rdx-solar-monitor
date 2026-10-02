const RDX_PRIMARY_HEX = '#174d3c';

function formatDateForExcel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-BO');
}

function formatNumberForExcel(val) {
  if (val === '' || val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? val : num;
}

function getStatusLabel(status) {
  const labels = {
    requested: 'Solicitada',
    received: 'Recibida',
    preparing: 'En preparación',
    ready: 'Lista para entrega',
    delivered: 'Entregada',
    rejected: 'Rechazada',
    cancelled: 'Cancelada',
  };
  return labels[status] ?? status;
}

function getReasonLabel(reason) {
  const labels = {
    installation: 'Instalación',
    maintenance: 'Mantenimiento',
    warranty: 'Garantía',
    replacement: 'Reemplazo',
    internal: 'Uso interno',
    other: 'Otro',
  };
  return labels[reason] ?? reason;
}

function getPriorityLabel(priority) {
  const labels = {
    low: 'Baja',
    normal: 'Normal',
    high: 'Alta',
    urgent: 'Urgente',
  };
  return labels[priority] ?? priority;
}

function getTrackingLabel(mode) {
  return mode === 'serialized' ? 'Serializado' : mode === 'quantity' ? 'Por cantidad' : mode;
}

function getCategoryLabel(category) {
  const labels = {
    inverter: 'Inversor',
    solar_panel: 'Panel solar',
    smart_meter: 'Smart meter',
    battery: 'Batería',
    datalogger: 'Datalogger',
    protection: 'Protección',
    structure: 'Estructura',
    cable: 'Cable',
    other: 'Otro',
  };
  return labels[category] ?? category;
}

function getDestinationDisplay(request) {
  if (request.destination_client?.name) {
    return request.destination_client.name;
  }
  return request.destination ?? '—';
}

function getPlantName(request) {
  return request.plant?.name ?? '—';
}

function applyHeaderStyle(worksheet, row, colCount) {
  const headerRow = worksheet.getRow(row);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: RDX_PRIMARY_HEX.replace('#', '') },
  };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow.height = 25;
  for (let i = 1; i <= colCount; i++) {
    const cell = headerRow.getCell(i);
    cell.border = {
      top: { style: 'thin', color: { argb: '000000' } },
      bottom: { style: 'thin', color: { argb: '000000' } },
      left: { style: 'thin', color: { argb: '000000' } },
      right: { style: 'thin', color: { argb: '000000' } },
    };
  }
}

function applyDataCellStyle(worksheet, row, colCount, isEven) {
  const dataRow = worksheet.getRow(row);
  dataRow.alignment = { vertical: 'middle', wrapText: true };
  if (isEven) {
    dataRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'F2F4F3' },
    };
  }
  dataRow.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const cell = dataRow.getCell(i);
    cell.border = {
      top: { style: 'thin', color: { argb: 'D0D8D3' } },
      bottom: { style: 'thin', color: { argb: 'D0D8D3' } },
      left: { style: 'thin', color: { argb: 'D0D8D3' } },
      right: { style: 'thin', color: { argb: 'D0D8D3' } },
    };
  }
}

function setColumnWidths(worksheet, widths) {
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
}

function addTitleRows(worksheet, title, subtitle, dateStr) {
  const titleRow = worksheet.getRow(1);
  titleRow.getCell(1).value = 'RDX Solar Monitor';
  titleRow.font = { bold: true, size: 16, color: { argb: '174D3C' } };
  titleRow.alignment = { vertical: 'middle' };
  titleRow.height = 30;

  const subtitleRow = worksheet.getRow(2);
  subtitleRow.getCell(1).value = subtitle;
  subtitleRow.font = { bold: true, size: 14, color: { argb: '174D3C' } };
  subtitleRow.alignment = { vertical: 'middle' };
  subtitleRow.height = 25;

  const dateRow = worksheet.getRow(3);
  dateRow.getCell(1).value = `Generado: ${dateStr}`;
  dateRow.font = { size: 11, color: { argb: '5B6D63' } };
  dateRow.alignment = { vertical: 'middle' };
  dateRow.height = 20;

  return 4;
}

function addFiltersRow(worksheet, filtersText, startRow, colCount) {
  if (!filtersText) return startRow;
  const row = worksheet.getRow(startRow);
  row.getCell(1).value = `Filtros: ${filtersText}`;
  row.font = { size: 10, color: { argb: '89948E' }, italic: true };
  row.alignment = { vertical: 'middle' };
  row.height = 18;
  return startRow + 1;
}

function getTodayString() {
  const now = new Date();
  return now.toLocaleDateString('es-BO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-');
}

export async function exportInventoryToExcel(products, filters = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Inventario');

  const headers = [
    'Producto',
    'Categoría',
    'Fabricante',
    'Modelo',
    'Seguimiento',
    'Unidad',
    'Disponible',
    'Despachado',
    'Asignado',
    'Instalado',
    'Stock físico',
    'Estado',
  ];

  const colWidths = [30, 18, 20, 18, 16, 12, 14, 14, 14, 14, 14, 12];

  let currentRow = 1;
  currentRow = addTitleRows(worksheet, 'Inventario', 'Inventario', new Date().toLocaleDateString('es-BO', { year: 'numeric', month: '2-digit', day: '2-digit' }));

  const filtersParts = [];
  if (filters.category) filtersParts.push(`Categoría: ${categoryLabel(categoryLabel(filters.category))}`);
  if (filters.trackingMode) filtersParts.push(`Seguimiento: ${filters.trackingMode === 'serialized' ? 'Serializado' : 'Por cantidad'}`);
  if (filters.active === 'true') filtersParts.push('Estado: Activos');
  if (filters.active === 'false') filtersParts.push('Estado: Inactivos');
  if (filters.search) filtersParts.push(`Buscar: "${filters.search}"`);
  const headerRowNum = addFiltersRow(worksheet, filtersParts.join(' | '), 4, headers.length);

  const headerRowNumFinal = headerRowNum + 1;
  const headerRow = worksheet.getRow(headerRowNumFinal);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderStyle(worksheet, headerRowNumFinal, headers.length);

  products.forEach((product, index) => {
    const rowNum = headerRowNumFinal + 1 + index;
    const row = worksheet.getRow(rowNum);
    row.getCell(1).value = product.name;
    row.getCell(2).value = getCategoryLabel(product.category);
    row.getCell(3).value = product.manufacturer ?? '—';
    row.getCell(4).value = product.model ?? '—';
    row.getCell(5).value = getTrackingLabel(product.tracking_mode);
    row.getCell(6).value = product.unit ?? '—';
    row.getCell(7).value = formatNumberForExcel(product.summary?.available);
    row.getCell(8).value = formatNumberForExcel(product.summary?.dispatched);
    row.getCell(9).value = formatNumberForExcel(product.summary?.assigned);
    row.getCell(10).value = formatNumberForExcel(product.summary?.installed);
    row.getCell(11).value = formatNumberForExcel(product.summary?.physical_stock);
    row.getCell(12).value = product.active ? 'Activo' : 'Inactivo';
    applyDataCellStyle(worksheet, rowNum, headers.length, index % 2 === 0);
  });

  const lastDataRow = headerRowNumFinal + products.length;
  worksheet.autoFilter = {
    from: { row: headerRowNumFinal, column: 1 },
    to: { row: lastDataRow, column: headers.length },
  };
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowNumFinal, activeCell: 'A1' }];

  setColumnWidths(worksheet, colWidths);

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `RDX_Inventario_${getTodayString()}.xlsx`;
  return { buffer, fileName };
}

export async function exportOperationsToExcel(requests, filters = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Solicitudes');

  const headers = [
    'Código',
    'Fecha',
    'Solicitante',
    'Cliente/Destino',
    'Planta',
    'Motivo',
    'Prioridad',
    'Estado',
    'Fecha requerida',
    'Cantidad de líneas',
  ];

  const colWidths = [18, 16, 22, 25, 18, 18, 14, 16, 16, 16];

  let currentRow = 1;
  currentRow = addTitleRows(worksheet, 'Solicitudes de materiales', 'Solicitudes de materiales', new Date().toLocaleDateString('es-BO', { year: 'numeric', month: '2-digit', day: '2-digit' }));

  const filtersParts = [];
  if (filters.status && filters.status !== 'all') filtersParts.push(`Estado: ${getStatusLabel(filters.status)}`);
  if (filters.priority && filters.priority !== 'all') filtersParts.push(`Prioridad: ${getPriorityLabel(filters.priority)}`);
  if (filters.reason && filters.reason !== 'all') filtersParts.push(`Motivo: ${getReasonLabel(filters.reason)}`);
  if (filters.plant && filters.plant !== 'all') filtersParts.push(`Planta: ${filters.plant}`);
  if (filters.dateFrom) filtersParts.push(`Desde: ${filters.dateFrom}`);
  if (filters.dateTo) filtersParts.push(`Hasta: ${filters.dateTo}`);
  const headerRowNum = addFiltersRow(worksheet, filtersParts.join(' | '), 4, 10);

  const headerRowNumFinal = headerRowNum + 1;
  const headerRow = worksheet.getRow(headerRowNumFinal);
  const opsHeaders = [
    'Código',
    'Fecha',
    'Solicitante',
    'Cliente/Destino',
    'Planta',
    'Motivo',
    'Prioridad',
    'Estado',
    'Fecha requerida',
    'Cantidad de líneas',
  ];
  opsHeaders.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderStyle(worksheet, headerRowNumFinal, opsHeaders.length);

  requests.forEach((request, index) => {
    const rowNum = headerRowNumFinal + 1 + index;
    const row = worksheet.getRow(rowNum);
    row.getCell(1).value = request.code;
    row.getCell(2).value = request.created_at ? new Date(request.created_at).toLocaleDateString('es-BO') : '—';
    row.getCell(3).value = request.requester?.display_name ?? '—';
    row.getCell(4).value = getDestinationDisplay(request);
    row.getCell(5).value = getPlantName(request);
    row.getCell(6).value = getReasonLabel(request.reason);
    row.getCell(7).value = getPriorityLabel(request.priority);
    row.getCell(8).value = getStatusLabel(request.status);
    row.getCell(9).value = request.required_at ? formatDateForExcel(request.required_at) : '—';
    row.getCell(10).value = request.line_count ?? 0;
    applyDataCellStyle(worksheet, rowNum, 10, index % 2 === 0);
  });

  const lastDataRow = headerRowNumFinal + requests.length;
  worksheet.autoFilter = {
    from: { row: headerRowNumFinal, column: 1 },
    to: { row: lastDataRow, column: 10 },
  };
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowNumFinal, activeCell: 'A1' }];

  setColumnWidths(worksheet, [18, 16, 22, 25, 18, 18, 14, 16, 16, 16]);

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `RDX_Solicitudes_Materiales_${getTodayString()}.xlsx`;
  return { buffer, fileName };
}

function triggerDownload(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadExcel(buffer, fileName) {
  triggerDownload(buffer, fileName);
}