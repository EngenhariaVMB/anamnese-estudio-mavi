import './styles.css';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const PUBLIC_FORM_URL = 'https://engenhariavmb.github.io/anamnese-estudio-mavi/';
const WHATSAPP_NUMBER = '5511992685534';
const TOTAL_STEPS = 5;

const form = document.querySelector('#anamneseForm');
const stepPanels = [...document.querySelectorAll('.form-step')];
const stepButtons = [...document.querySelectorAll('.step-dot')];
const progressBar = document.querySelector('#progressBar');
const qrDialog = document.querySelector('#qrDialog');
const successDialog = document.querySelector('#successDialog');
const loadingOverlay = document.querySelector('#loadingOverlay');
const toast = document.querySelector('#toast');
const phoneInput = form.elements.phone;
const birthDateInput = form.elements.birthDate;
const ageInput = form.elements.age;

form.querySelectorAll('input[type="text"]').forEach((input) => { input.maxLength = 180; });
form.elements.fullName.maxLength = 120;
form.elements.phone.maxLength = 15;
form.elements.email.maxLength = 254;
form.elements.observations.maxLength = 2000;

let currentStep = 1;
let maxUnlockedStep = 1;
let formDirty = false;
let lastPdf = null;
let toastTimer = null;

const drawingState = {
  faceMap: { dirty: false },
  client: { dirty: false },
  professional: { dirty: false },
};

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return 'Não informado';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function calculateAge(dateString) {
  if (!dateString) return '';
  const birth = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(birth.getTime()) || birth > new Date()) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDifference = today.getMonth() - birth.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? `${age} anos` : '';
}

function maskPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function setLoading(isLoading) {
  loadingOverlay.hidden = !isLoading;
}

function setStep(step, { scroll = true } = {}) {
  currentStep = Math.max(1, Math.min(TOTAL_STEPS, step));
  stepPanels.forEach((panel) => {
    const isCurrent = Number(panel.dataset.step) === currentStep;
    panel.hidden = !isCurrent;
    panel.classList.toggle('is-active', isCurrent);
  });
  stepButtons.forEach((button, index) => {
    const stepNumber = index + 1;
    button.disabled = stepNumber > maxUnlockedStep;
    button.classList.toggle('is-active', stepNumber === currentStep);
    button.classList.toggle('is-complete', stepNumber < currentStep || stepNumber < maxUnlockedStep);
    if (stepNumber === currentStep) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  progressBar.style.width = `${(currentStep / TOTAL_STEPS) * 100}%`;
  if (currentStep === 4) updateRiskAlert();
  if (scroll) {
    document.querySelector('.stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => stepPanels[currentStep - 1].querySelector('input, textarea, button')?.focus({ preventScroll: true }), 360);
  }
}

function clearValidation(panel) {
  panel.querySelectorAll('.is-invalid').forEach((element) => element.classList.remove('is-invalid'));
  panel.querySelectorAll('.field-error').forEach((element) => element.classList.remove('is-visible'));
}

function markInvalid(element) {
  const container = element.closest('.field, .radio-field, .consent-check') || element;
  container.classList.add('is-invalid');
  if (element.matches('input:not([type="radio"]):not([type="checkbox"]), textarea')) element.classList.add('is-invalid');
  return container;
}

function validateStep(step, { focus = true } = {}) {
  const panel = stepPanels[step - 1];
  clearValidation(panel);
  let firstInvalid = null;

  panel.querySelectorAll('input[required], textarea[required]').forEach((input) => {
    if (input.type === 'radio') {
      const group = panel.querySelectorAll(`input[type="radio"][name="${CSS.escape(input.name)}"]`);
      if (![...group].some((radio) => radio.checked)) firstInvalid ||= markInvalid(input);
      return;
    }
    if (input.type === 'checkbox') {
      if (!input.checked) firstInvalid ||= markInvalid(input);
      return;
    }
    if (!input.checkValidity() || !input.value.trim()) firstInvalid ||= markInvalid(input);
  });

  if (step === 1) {
    const hasProcedure = [...panel.querySelectorAll('input[name="procedure"]')].some((input) => input.checked)
      || form.elements.procedureOther.value.trim();
    if (!hasProcedure) {
      panel.querySelector('[data-error-for="procedure"]').classList.add('is-visible');
      firstInvalid ||= panel.querySelector('[data-required-group="procedure"]');
    }
  }

  if (step === 5 && !drawingState.client.dirty) {
    document.querySelector('#clientSignatureError').classList.add('is-visible');
    document.querySelector('#clientSignature').closest('.signature-card').classList.add('is-invalid');
    firstInvalid ||= document.querySelector('#clientSignature');
  }

  if (firstInvalid && focus) {
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const target = firstInvalid.matches?.('input, textarea, button') ? firstInvalid : firstInvalid.querySelector?.('input, textarea, button');
    setTimeout(() => target?.focus({ preventScroll: true }), 350);
    showToast('Revise os campos obrigatórios destacados.');
  }
  return !firstInvalid;
}

function validateAll() {
  for (let step = 1; step <= TOTAL_STEPS; step += 1) {
    if (!validateStep(step, { focus: false })) {
      maxUnlockedStep = Math.max(maxUnlockedStep, step);
      setStep(step);
      validateStep(step, { focus: true });
      return false;
    }
  }
  return true;
}

function updateRiskAlert() {
  const marked = form.querySelectorAll('input[name="contraindications"]:checked').length > 0
    || form.elements.contraindicationOther.value.trim();
  document.querySelector('#riskAlert').hidden = !marked;
}

function getPointerPosition(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function drawFaceTemplate(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fffaf8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#9f8987';
  ctx.fillStyle = '#7c6968';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.font = '600 18px Arial';
  ctx.textAlign = 'center';

  const drawFront = (cx, label) => {
    ctx.beginPath();
    ctx.ellipse(cx, 133, 76, 100, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 62, 96);
    ctx.quadraticCurveTo(cx, 34, cx + 62, 96);
    ctx.moveTo(cx - 46, 126);
    ctx.quadraticCurveTo(cx - 28, 116, cx - 10, 126);
    ctx.moveTo(cx + 10, 126);
    ctx.quadraticCurveTo(cx + 28, 116, cx + 46, 126);
    ctx.moveTo(cx, 130);
    ctx.quadraticCurveTo(cx - 7, 156, cx + 3, 163);
    ctx.moveTo(cx - 25, 184);
    ctx.quadraticCurveTo(cx, 195, cx + 25, 184);
    ctx.moveTo(cx - 35, 224);
    ctx.lineTo(cx - 38, 261);
    ctx.moveTo(cx + 35, 224);
    ctx.lineTo(cx + 38, 261);
    ctx.moveTo(cx - 38, 261);
    ctx.quadraticCurveTo(cx, 285, cx + 38, 261);
    ctx.stroke();
    ctx.fillText(label, cx, 318);
  };

  const drawSide = (cx, label, direction = 1) => {
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(direction, 1);
    ctx.beginPath();
    ctx.moveTo(-58, 84);
    ctx.quadraticCurveTo(-15, 25, 50, 67);
    ctx.quadraticCurveTo(75, 88, 51, 116);
    ctx.lineTo(74, 132);
    ctx.lineTo(49, 145);
    ctx.quadraticCurveTo(58, 172, 36, 195);
    ctx.quadraticCurveTo(2, 230, -37, 204);
    ctx.quadraticCurveTo(-78, 178, -58, 84);
    ctx.moveTo(18, 122);
    ctx.quadraticCurveTo(36, 112, 51, 121);
    ctx.moveTo(47, 145);
    ctx.quadraticCurveTo(38, 158, 51, 163);
    ctx.moveTo(37, 195);
    ctx.lineTo(34, 261);
    ctx.moveTo(-25, 214);
    ctx.lineTo(-30, 261);
    ctx.stroke();
    ctx.restore();
    ctx.fillText(label, cx, 318);
  };

  drawFront(160, 'FRENTE');
  drawSide(450, 'LADO DIREITO', 1);
  drawSide(740, 'LADO ESQUERDO', -1);
}

function clearSignature(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#eadbd8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(55, 188);
  ctx.lineTo(canvas.width - 55, 188);
  ctx.stroke();
}

function setupDrawingCanvas(canvas, stateKey, options = {}) {
  const ctx = canvas.getContext('2d');
  const { background = () => clearSignature(canvas), stroke = '#71363b', lineWidth = 4 } = options;
  let drawing = false;
  let previous = null;

  background(canvas);

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    previous = getPointerPosition(canvas, event);
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(previous.x, previous.y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    drawingState[stateKey].dirty = true;
    if (stateKey === 'client') document.querySelector('#clientSignatureError').classList.remove('is-visible');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    event.preventDefault();
    const next = getPointerPosition(canvas, event);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    previous = next;
  });

  const stop = (event) => {
    if (!drawing) return;
    drawing = false;
    previous = null;
    if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', stop);

  return () => {
    background(canvas);
    drawingState[stateKey].dirty = false;
  };
}

const clearFaceMap = setupDrawingCanvas(
  document.querySelector('#faceMapCanvas'),
  'faceMap',
  { background: drawFaceTemplate, stroke: '#a84f57', lineWidth: 5 },
);
const clearClientSignature = setupDrawingCanvas(document.querySelector('#clientSignature'), 'client', { lineWidth: 5 });
const clearProfessionalSignature = setupDrawingCanvas(document.querySelector('#professionalSignature'), 'professional', { lineWidth: 5 });

function collectFormData() {
  const data = new FormData(form);
  const one = (name, fallback = 'Não informado') => {
    const value = data.get(name);
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  };
  const many = (name, otherName) => {
    const values = data.getAll(name).filter(Boolean).map(String);
    const other = otherName ? one(otherName, '') : '';
    if (other) values.push(`Outro: ${other}`);
    return values.length ? values : ['Nenhum item informado'];
  };
  return {
    fullName: one('fullName'),
    birthDate: formatDate(one('birthDate', '')),
    age: one('age'),
    phone: one('phone'),
    email: one('email'),
    profession: one('profession'),
    procedures: many('procedure', 'procedureOther'),
    health: many('health', 'healthOther'),
    medicalTreatment: one('medicalTreatment'),
    medications: one('medications'),
    productAllergy: one('productAllergy'),
    allergyDetails: one('allergyDetails'),
    contraindications: many('contraindications', 'contraindicationOther'),
    smokes: one('smokes'),
    smokingFrequency: one('smokingFrequency'),
    alcohol: one('alcohol'),
    alcoholFrequency: one('alcoholFrequency'),
    sunExposure: one('sunExposure'),
    tanning: one('tanning'),
    previousMicropigmentation: one('previousMicropigmentation'),
    previousProcedure: one('previousProcedure'),
    previousProcedureTime: one('previousProcedureTime'),
    previousReaction: one('previousReaction'),
    reactionDetails: one('reactionDetails'),
    skinEvaluation: many('skinEvaluation', 'skinEvaluationOther'),
    observations: one('observations'),
    professionalName: one('professionalName'),
  };
}

function makeProtocol() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const random = crypto.getRandomValues(new Uint16Array(1))[0].toString(36).toUpperCase().padStart(3, '0').slice(-3);
  return `MAVI-${datePart}-${random}`;
}

function safeFileName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'cliente';
}

function buildPdf() {
  const values = collectFormData();
  const protocol = makeProtocol();
  const generatedAt = new Date();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const margin = 15;
  const contentWidth = 180;
  const pageBottom = 279;
  let y = 0;

  const wine = [133, 60, 66];
  const rose = [239, 200, 199];
  const pale = [252, 240, 237];
  const ink = [54, 44, 44];
  const muted = [112, 94, 94];

  const addHeader = (subtitle = 'Ficha de Anamnese') => {
    doc.setFillColor(...pale);
    doc.rect(0, 0, 210, 34, 'F');
    doc.setTextColor(...wine);
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.text('S T U D I O', 105, 9, { align: 'center' });
    doc.setFontSize(24);
    doc.text('M A V I', 105, 20, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('BELEZA QUE INSPIRA', 105, 26, { align: 'center' });
    doc.setDrawColor(...rose);
    doc.line(margin, 30, 195, 30);
    doc.setFont('times', 'normal');
    doc.setFontSize(13);
    doc.text(subtitle.toUpperCase(), margin, 41);
    y = 47;
  };

  const newPage = (subtitle) => {
    doc.addPage();
    addHeader(subtitle);
  };

  const ensureSpace = (height, subtitle = 'Ficha de Anamnese') => {
    if (y + height > pageBottom) newPage(subtitle);
  };

  const section = (title) => {
    ensureSpace(13);
    doc.setFillColor(...pale);
    doc.roundedRect(margin, y, contentWidth, 8, 2, 2, 'F');
    doc.setTextColor(...wine);
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text(title, margin + 4, y + 5.5);
    y += 12;
  };

  const row = (items) => {
    const gap = 6;
    const width = (contentWidth - gap * (items.length - 1)) / items.length;
    const lineSets = items.map(({ value }) => doc.splitTextToSize(String(value || 'Não informado'), width - 3));
    const height = Math.max(...lineSets.map((lines) => lines.length)) * 4.2 + 8;
    ensureSpace(height);
    items.forEach(({ label, value }, index) => {
      const x = margin + index * (width + gap);
      doc.setTextColor(...muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.text(label.toUpperCase(), x, y);
      doc.setTextColor(...ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      const lines = doc.splitTextToSize(String(value || 'Não informado'), width - 2);
      doc.text(lines, x, y + 4.6);
      doc.setDrawColor(229, 210, 207);
      doc.line(x, y + height - 2.5, x + width, y + height - 2.5);
    });
    y += height;
  };

  const list = (label, valuesList) => {
    const text = valuesList.join(' • ');
    const lines = doc.splitTextToSize(text, contentWidth - 5);
    const height = lines.length * 4.2 + 9;
    ensureSpace(height);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.text(label.toUpperCase(), margin, y);
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    doc.text(lines, margin, y + 4.7);
    y += height;
  };

  addHeader('Ficha de Anamnese');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text(`Protocolo: ${protocol}`, margin, y);
  doc.text(`Gerado em: ${formatDateTime(generatedAt)}`, 195, y, { align: 'right' });
  y += 8;

  section('1. Dados pessoais');
  row([{ label: 'Nome completo', value: values.fullName }]);
  row([{ label: 'Data de nascimento', value: values.birthDate }, { label: 'Idade', value: values.age }]);
  row([{ label: 'Telefone / WhatsApp', value: values.phone }, { label: 'E-mail', value: values.email }]);
  row([{ label: 'Profissão', value: values.profession }]);

  section('2. Procedimento desejado');
  list('Procedimentos selecionados', values.procedures);

  section('3. Histórico de saúde');
  list('Condições informadas', values.health);
  row([{ label: 'Em tratamento médico', value: values.medicalTreatment }, { label: 'Medicamentos em uso', value: values.medications }]);
  row([{ label: 'Alergia a cosméticos, anestésicos ou metais', value: values.productAllergy }, { label: 'Detalhes das alergias', value: values.allergyDetails }]);

  section('4. Contraindicações');
  list('Itens marcados', values.contraindications);

  newPage('Hábitos e avaliação');
  section('5. Hábitos');
  row([{ label: 'Fuma', value: values.smokes }, { label: 'Frequência', value: values.smokingFrequency }]);
  row([{ label: 'Consome álcool', value: values.alcohol }, { label: 'Frequência', value: values.alcoholFrequency }]);
  row([{ label: 'Exposição solar excessiva', value: values.sunExposure }, { label: 'Bronzeamento artificial', value: values.tanning }]);

  section('6. Histórico da pele / área');
  row([{ label: 'Já realizou micropigmentação', value: values.previousMicropigmentation }, { label: 'Procedimento anterior', value: values.previousProcedure }]);
  row([{ label: 'Há quanto tempo', value: values.previousProcedureTime }, { label: 'Teve reação', value: values.previousReaction }]);
  row([{ label: 'Detalhes da reação', value: values.reactionDetails }]);

  section('7. Avaliação da pele / área');
  list('Características observadas', values.skinEvaluation);
  ensureSpace(73);
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text('MAPA DA ÁREA', margin, y);
  doc.addImage(document.querySelector('#faceMapCanvas').toDataURL('image/png'), 'PNG', margin, y + 3, contentWidth, 68, undefined, 'FAST');
  y += 76;

  section('8. Observações');
  const observationLines = doc.splitTextToSize(values.observations, contentWidth - 4);
  const observationLineHeight = 4.3;
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  while (observationLines.length) {
    const availableLines = Math.max(0, Math.floor((pageBottom - y) / observationLineHeight));
    if (availableLines < 2) {
      newPage('Observações complementares');
      section('8. Observações - continuação');
      continue;
    }
    const chunk = observationLines.splice(0, availableLines);
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    doc.text(chunk, margin, y);
    y += chunk.length * observationLineHeight + 6;
    if (observationLines.length) {
      newPage('Observações complementares');
      section('8. Observações - continuação');
    }
  }

  newPage('Consentimento e assinaturas');
  section('9. Termo de consentimento');
  const consentText = 'Declaro que as informações prestadas nesta ficha são verdadeiras e completas. Fui informada sobre o procedimento, os cuidados necessários, os riscos, as contraindicações e os possíveis resultados. Autorizo a realização do procedimento após a avaliação da profissional responsável.';
  const consentLines = doc.splitTextToSize(consentText, contentWidth);
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(consentLines, margin, y);
  y += consentLines.length * 4.6 + 7;
  doc.setTextColor(...wine);
  doc.setFont('helvetica', 'bold');
  doc.text('[X] Consentimento confirmado eletronicamente na ficha.', margin, y);
  y += 11;

  section('Autorização para tratamento de dados e WhatsApp');
  const privacyText = 'A cliente autorizou o Studio Mavi a tratar os dados pessoais e de saúde desta ficha para avaliação, atendimento, registro e acompanhamento, bem como a gerar e compartilhar este PDF por meio do WhatsApp mediante ação no próprio aparelho.';
  const privacyLines = doc.splitTextToSize(privacyText, contentWidth);
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(privacyLines, margin, y);
  y += privacyLines.length * 4.6 + 12;

  section('Assinaturas');
  ensureSpace(75);
  const clientSignature = document.querySelector('#clientSignature').toDataURL('image/png');
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text('ASSINATURA DA CLIENTE', margin, y);
  doc.addImage(clientSignature, 'PNG', margin, y + 3, 82, 28, undefined, 'FAST');
  doc.setDrawColor(...rose);
  doc.line(margin, y + 32, margin + 82, y + 32);
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(values.fullName, margin, y + 37);

  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text('ASSINATURA DA PROFISSIONAL', 113, y);
  if (drawingState.professional.dirty) {
    doc.addImage(document.querySelector('#professionalSignature').toDataURL('image/png'), 'PNG', 113, y + 3, 82, 28, undefined, 'FAST');
  }
  doc.setDrawColor(...rose);
  doc.line(113, y + 32, 195, y + 32);
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(values.professionalName, 113, y + 37);
  y += 48;

  row([{ label: 'Data do registro', value: formatDateTime(generatedAt) }, { label: 'Protocolo', value: protocol }]);

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...rose);
    doc.line(margin, 287, 195, 287);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text('Studio Mavi • Micropigmentação & Estética • @studio_mavi_estetica', margin, 292);
    doc.text(`Página ${page} de ${totalPages}`, 195, 292, { align: 'right' });
  }

  const blob = doc.output('blob');
  const filename = `anamnese-${safeFileName(values.fullName)}-${todayIso()}.pdf`;
  return { blob, filename, protocol, values, generatedAt };
}

function triggerDownload(pdf = lastPdf) {
  if (!pdf) return;
  const url = URL.createObjectURL(pdf.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = pdf.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function whatsappUrl(pdf = lastPdf) {
  const name = pdf?.values?.fullName || 'cliente';
  const protocol = pdf?.protocol || '';
  const text = `Olá! Segue a ficha de anamnese de ${name}. Protocolo: ${protocol}. O PDF foi gerado no aparelho e deve ser anexado nesta conversa.`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function updateSuccessDialog(message) {
  document.querySelector('#successMessage').textContent = message;
  document.querySelector('#protocolValue').textContent = lastPdf?.protocol || '—';
  document.querySelector('#openWhatsAppButton').href = whatsappUrl();
}

async function sharePdf(pdf = lastPdf) {
  if (!pdf) return false;
  const file = new File([pdf.blob], pdf.filename, { type: 'application/pdf' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({
        files: [file],
        title: 'Ficha de Anamnese — Studio Mavi',
        text: `Ficha de anamnese. Protocolo ${pdf.protocol}.`,
      });
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }
  }
  return false;
}

async function generateAndDownload() {
  if (!validateAll()) return;
  setLoading(true);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    lastPdf = buildPdf();
    triggerDownload(lastPdf);
    formDirty = false;
    updateSuccessDialog('O PDF foi baixado neste aparelho. Você também pode compartilhá-lo pelo WhatsApp.');
    openDialog(successDialog);
  } catch (error) {
    console.error(error);
    showToast('Não foi possível gerar o PDF. Tente novamente.');
  } finally {
    setLoading(false);
  }
}

async function generateAndShare() {
  if (!validateAll()) return;
  setLoading(true);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    lastPdf = buildPdf();
    formDirty = false;
    setLoading(false);
    const shared = await sharePdf(lastPdf);
    if (shared) {
      updateSuccessDialog('O compartilhamento foi aberto no aparelho. Confirme no WhatsApp o contato de destino.');
    } else {
      triggerDownload(lastPdf);
      window.open(whatsappUrl(lastPdf), '_blank', 'noopener');
      updateSuccessDialog('Seu navegador não anexou o arquivo automaticamente. O PDF foi baixado e a conversa do WhatsApp foi aberta; anexe o arquivo nessa conversa.');
    }
    openDialog(successDialog);
  } catch (error) {
    console.error(error);
    setLoading(false);
    showToast('Não foi possível gerar ou compartilhar o PDF. Tente novamente.');
  }
}

async function renderQrCode() {
  const canvas = document.querySelector('#qrCanvas');
  await QRCode.toCanvas(canvas, PUBLIC_FORM_URL, {
    width: 260,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: '#71363b', light: '#ffffff' },
  });
  const link = document.querySelector('#publicFormLink');
  link.href = PUBLIC_FORM_URL;
  link.textContent = PUBLIC_FORM_URL;
}

function downloadQrCode() {
  const source = document.querySelector('#qrCanvas');
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff8f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#853c42';
  ctx.textAlign = 'center';
  ctx.font = '44px Georgia';
  ctx.fillText('S T U D I O', 600, 125);
  ctx.font = '110px Georgia';
  ctx.fillText('M A V I', 600, 245);
  ctx.font = '52px Georgia';
  ctx.fillText('FICHA DE ANAMNESE', 600, 355);
  ctx.font = '30px Arial';
  ctx.fillStyle = '#776767';
  ctx.fillText('Escaneie para preencher pelo celular', 600, 415);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e8ceca';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(230, 465, 740, 740, 40);
  ctx.fill();
  ctx.stroke();
  ctx.drawImage(source, 290, 525, 620, 620);
  ctx.fillStyle = '#853c42';
  ctx.font = '26px Arial';
  ctx.fillText('Micropigmentação & Estética', 600, 1285);
  ctx.font = '22px Arial';
  ctx.fillStyle = '#776767';
  ctx.fillText('@studio_mavi_estetica', 600, 1335);
  const anchor = document.createElement('a');
  anchor.href = canvas.toDataURL('image/png');
  anchor.download = 'qrcode-ficha-anamnese-studio-mavi.png';
  anchor.click();
}

async function copyPublicLink() {
  try {
    await navigator.clipboard.writeText(PUBLIC_FORM_URL);
    showToast('Link copiado.');
  } catch {
    const input = document.createElement('input');
    input.value = PUBLIC_FORM_URL;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Link copiado.');
  }
}

document.querySelectorAll('[data-next]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    maxUnlockedStep = Math.max(maxUnlockedStep, currentStep + 1);
    setStep(currentStep + 1);
  });
});

document.querySelectorAll('[data-prev]').forEach((button) => button.addEventListener('click', () => setStep(currentStep - 1)));
stepButtons.forEach((button) => button.addEventListener('click', () => {
  const target = Number(button.dataset.goStep);
  if (target <= maxUnlockedStep) setStep(target);
}));

form.addEventListener('input', (event) => {
  formDirty = true;
  event.target.classList.remove('is-invalid');
  event.target.closest('.field, .radio-field, .consent-check')?.classList.remove('is-invalid');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  generateAndShare();
});

birthDateInput.max = todayIso();
birthDateInput.addEventListener('change', () => {
  ageInput.value = calculateAge(birthDateInput.value);
});

phoneInput.addEventListener('input', () => {
  phoneInput.value = maskPhone(phoneInput.value);
});

document.querySelector('#clearFaceMap').addEventListener('click', () => {
  clearFaceMap();
  showToast('Marcações removidas.');
});

document.querySelectorAll('[data-clear-signature]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.clearSignature === 'client') clearClientSignature();
    else clearProfessionalSignature();
    showToast('Assinatura removida.');
  });
});

document.querySelector('#downloadPdfButton').addEventListener('click', generateAndDownload);
document.querySelector('#downloadAgainButton').addEventListener('click', () => triggerDownload());
document.querySelector('#retryShareButton').addEventListener('click', async () => {
  const shared = await sharePdf();
  if (!shared) {
    triggerDownload();
    window.open(whatsappUrl(), '_blank', 'noopener');
    showToast('PDF baixado. Anexe-o na conversa aberta.');
  }
});

document.querySelector('#openQrButton').addEventListener('click', () => openDialog(qrDialog));
document.querySelector('#downloadQrButton').addEventListener('click', downloadQrCode);
document.querySelector('#copyLinkButton').addEventListener('click', copyPublicLink);
document.querySelector('#printQrButton').addEventListener('click', () => window.print());

document.querySelectorAll('[data-close-modal]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(button.closest('dialog')));
});

[qrDialog, successDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closeDialog(dialog);
  });
});

window.addEventListener('beforeunload', (event) => {
  if (!formDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

renderQrCode().then(() => {
  if (new URLSearchParams(window.location.search).get('qr') === '1') openDialog(qrDialog);
}).catch((error) => {
  console.error('Falha ao gerar QR Code', error);
  showToast('Não foi possível exibir o QR Code neste momento.');
});

setStep(1, { scroll: false });
