const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxpbKdTr92aFqqhLDFbAoSNDb_FAJ2xqw3_K0nNSyfpDO1cyZn1nxHBT_vpT7XEs-Es/exec";
const SAVE_MODE = "google_sheets";
const STORAGE_KEY = "detree_other_expenses_v1";
const TARGET_SHEET = "other_expenses";

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม"
];

const NOTE_REQUIRED_TYPES = new Set([
  "เงินคืนจากการคืนสินค้า",
  "เงินเดือนพนักงาน",
  "เงินคืนแม่"
]);

const STATUS_LABELS = {
  sending: "กำลังส่ง",
  sent: "ส่งแล้ว",
  failed: "ส่งไม่สำเร็จ"
};

let elements = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  bindEvents();
  setDefaultDate();
  renderTable();
}

function cacheElements() {
  elements = {
    form: document.getElementById("expense-form"),
    paymentDate: document.getElementById("payment-date"),
    expenseType: document.getElementById("expense-type"),
    amountInput: document.getElementById("amount-input"),
    noteInput: document.getElementById("note-input"),
    noteHint: document.getElementById("note-hint"),
    saveButton: document.getElementById("save-button"),
    resetFormButton: document.getElementById("reset-form-button"),
    exportCsvButton: document.getElementById("export-csv-button"),
    clearLocalButton: document.getElementById("clear-local-button"),
    statusMessage: document.getElementById("status-message"),
    statusError: document.getElementById("status-error"),
    recordsBody: document.getElementById("records-body"),
    emptyState: document.getElementById("empty-state"),
    selectedDateLabel: document.getElementById("selected-date-label"),
    successModal: document.getElementById("success-modal"),
    successSummary: document.getElementById("success-summary"),
    nextEntryButton: document.getElementById("next-entry-button"),
    closeModalButton: document.getElementById("close-modal-button"),
    errors: {
      paymentDate: document.getElementById("payment-date-error"),
      expenseType: document.getElementById("expense-type-error"),
      amountInput: document.getElementById("amount-input-error"),
      noteInput: document.getElementById("note-input-error")
    }
  };
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.expenseType.addEventListener("change", updateNoteHint);
  elements.paymentDate.addEventListener("change", renderTable);
  elements.resetFormButton.addEventListener("click", resetForm);
  elements.exportCsvButton.addEventListener("click", exportCSV);
  elements.clearLocalButton.addEventListener("click", clearLocalData);
  elements.nextEntryButton.addEventListener("click", () => {
    closeSuccessModal();
    resetForm({ keepDate: true, focusType: true });
  });
  elements.closeModalButton.addEventListener("click", closeSuccessModal);
  elements.successModal.addEventListener("click", (event) => {
    if (event.target === elements.successModal) {
      closeSuccessModal();
    }
  });
}

function setDefaultDate() {
  if (!elements.paymentDate.value) {
    elements.paymentDate.value = getTodayDateString();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearErrors();

  if (!validateForm()) {
    return;
  }

  let record = null;
  try {
    const row = buildRow();
    record = createLocalRecord(row, "sending");

    saveLocalRecord(record);
    renderTable();
    showSuccessModal(row);

    if (SAVE_MODE !== "google_sheets") {
      showStatus("บันทึกในเครื่องแล้ว");
      return;
    }

    if (!navigator.onLine) {
      updateLocalRecord(record._id, {
        _syncStatus: "failed",
        _lastSyncAttemptAt: new Date().toISOString(),
        _syncError: "offline"
      });
      renderTable();
      showError("อุปกรณ์ออฟไลน์ ข้อมูลถูกเก็บในเครื่องแล้ว กรุณากดส่งซ้ำเมื่อมีอินเทอร์เน็ต");
      return;
    }

    showStatus("บันทึกในเครื่องแล้ว กำลังส่งเข้า Google Sheet...");
    setSubmitting(true);

    try {
      await submitToGoogleSheet(record);
      updateLocalRecord(record._id, {
        _syncStatus: "sent",
        _lastSyncAttemptAt: new Date().toISOString(),
        _syncError: ""
      });
      showStatus("ส่งเข้า Google Sheet แล้ว");
    } catch (error) {
      updateLocalRecord(record._id, {
        _syncStatus: "failed",
        _lastSyncAttemptAt: new Date().toISOString(),
        _syncError: error.message || "ส่งไม่สำเร็จ"
      });
      showError("ส่งเข้า Google Sheet ไม่สำเร็จ แต่ข้อมูลยังอยู่ในเครื่อง กรุณากดส่งซ้ำ");
    } finally {
      setSubmitting(false);
      renderTable();
    }
  } catch (error) {
    setSubmitting(false);
    if (record && record._id) {
      updateLocalRecord(record._id, {
        _syncStatus: "failed",
        _lastSyncAttemptAt: new Date().toISOString(),
        _syncError: error.message || "unexpected error"
      });
      renderTable();
    }
    console.error(error);
    showError("เกิดข้อผิดพลาดระหว่างบันทึก กรุณาลองใหม่อีกครั้ง");
  }
}

function convertDateToThaiParts(dateString) {
  const [yearText, monthText, dayText] = dateString.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  return {
    "ปี": year + 543,
    "เดือน": THAI_MONTHS[month - 1],
    "วัน": day
  };
}

function isNoteRequired(type) {
  return NOTE_REQUIRED_TYPES.has(type);
}

function validateForm() {
  let isValid = true;
  const dateValue = elements.paymentDate.value;
  const typeValue = elements.expenseType.value;
  const amountText = elements.amountInput.value.trim().replace(/,/g, "");
  const amountValue = Number(amountText);
  const noteValue = elements.noteInput.value.trim();

  if (!dateValue) {
    elements.errors.paymentDate.textContent = "กรุณาเลือกวันที่จ่าย";
    isValid = false;
  }

  if (!typeValue) {
    elements.errors.expenseType.textContent = "กรุณาเลือกประเภท";
    isValid = false;
  }

  if (!amountText) {
    elements.errors.amountInput.textContent = "กรุณากรอกยอดที่จ่าย";
    isValid = false;
  } else if (!Number.isFinite(amountValue) || amountValue <= 0) {
    elements.errors.amountInput.textContent = "ยอดที่จ่ายต้องเป็นตัวเลขมากกว่า 0";
    isValid = false;
  }

  if (isNoteRequired(typeValue) && !noteValue) {
    elements.errors.noteInput.textContent = "กรุณาใส่หมายเหตุสำหรับประเภทนี้";
    isValid = false;
  }

  if (!isValid) {
    showError("กรุณาตรวจสอบข้อมูลในฟอร์ม");
  }

  return isValid;
}

function buildRow() {
  const thaiDate = convertDateToThaiParts(elements.paymentDate.value);
  const amount = Number(elements.amountInput.value.trim().replace(/,/g, ""));

  return {
    ...thaiDate,
    "ประเภท": elements.expenseType.value,
    "ยอดที่จ่าย": amount,
    "หมายเหตุ": elements.noteInput.value.trim()
  };
}

function createLocalRecord(row, status) {
  const now = new Date().toISOString();

  return {
    _id: createRecordId(),
    _syncStatus: status,
    _createdAt: now,
    _lastSyncAttemptAt: status === "sending" ? now : "",
    _syncError: "",
    ...row
  };
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    showError("อ่านข้อมูลในเครื่องไม่สำเร็จ");
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function saveLocalRecord(record) {
  const records = loadRecords();
  records.unshift(record);
  saveRecords(records);
}

function updateLocalRecord(recordId, patch) {
  const records = loadRecords().map((record) => (
    record._id === recordId ? { ...record, ...patch } : record
  ));
  saveRecords(records);
}

function renderTable() {
  const visibleRecords = getVisibleRecordsForSelectedDate();
  elements.recordsBody.innerHTML = "";

  if (elements.paymentDate.value) {
    const dateParts = convertDateToThaiParts(elements.paymentDate.value);
    elements.selectedDateLabel.textContent = `${dateParts["วัน"]} ${dateParts["เดือน"]} ${dateParts["ปี"]}`;
  } else {
    elements.selectedDateLabel.textContent = "";
  }

  visibleRecords.forEach((record) => {
    const row = document.createElement("tr");
    row.appendChild(createCell(record["ปี"]));
    row.appendChild(createCell(record["เดือน"]));
    row.appendChild(createCell(record["วัน"]));
    row.appendChild(createCell(record["ประเภท"]));
    row.appendChild(createCell(formatAmount(record["ยอดที่จ่าย"])));
    row.appendChild(createCell(record["หมายเหตุ"] || "-", "note-cell"));
    row.appendChild(createStatusCell(record._syncStatus));
    row.appendChild(createActionCell(record));
    elements.recordsBody.appendChild(row);
  });

  elements.emptyState.classList.toggle("visible", visibleRecords.length === 0);
}

function getVisibleRecordsForSelectedDate() {
  if (!elements.paymentDate.value) {
    return [];
  }

  const selectedDate = convertDateToThaiParts(elements.paymentDate.value);
  return loadRecords().filter((record) => (
    record["ปี"] === selectedDate["ปี"] &&
    record["เดือน"] === selectedDate["เดือน"] &&
    Number(record["วัน"]) === selectedDate["วัน"]
  ));
}

async function submitToGoogleSheet(record) {
  const payload = {
    "_targetSheet": TARGET_SHEET,
    ...getSheetPayload(record)
  };

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
}

function getSheetPayload(record) {
  return {
    "ปี": record["ปี"],
    "เดือน": record["เดือน"],
    "วัน": record["วัน"],
    "ประเภท": record["ประเภท"],
    "ยอดที่จ่าย": record["ยอดที่จ่าย"],
    "หมายเหตุ": record["หมายเหตุ"] || ""
  };
}

async function retryRecord(recordId) {
  const record = loadRecords().find((item) => item._id === recordId);
  if (!record) {
    showError("ไม่พบรายการที่ต้องการส่งซ้ำ");
    return;
  }

  if (!navigator.onLine) {
    updateLocalRecord(recordId, {
      _syncStatus: "failed",
      _lastSyncAttemptAt: new Date().toISOString(),
      _syncError: "offline"
    });
    renderTable();
    showError("อุปกรณ์ออฟไลน์ ข้อมูลยังอยู่ในเครื่อง กรุณากดส่งซ้ำเมื่อมีอินเทอร์เน็ต");
    return;
  }

  updateLocalRecord(recordId, {
    _syncStatus: "sending",
    _lastSyncAttemptAt: new Date().toISOString(),
    _syncError: ""
  });
  renderTable();
  showStatus("กำลังส่งซ้ำเข้า Google Sheet...");

  try {
    await submitToGoogleSheet(record);
    updateLocalRecord(recordId, {
      _syncStatus: "sent",
      _lastSyncAttemptAt: new Date().toISOString(),
      _syncError: ""
    });
    showStatus("ส่งเข้า Google Sheet แล้ว");
  } catch (error) {
    updateLocalRecord(recordId, {
      _syncStatus: "failed",
      _lastSyncAttemptAt: new Date().toISOString(),
      _syncError: error.message || "ส่งไม่สำเร็จ"
    });
    showError("ส่งเข้า Google Sheet ไม่สำเร็จ แต่ข้อมูลยังอยู่ในเครื่อง กรุณากดส่งซ้ำ");
  } finally {
    renderTable();
  }
}

function deleteRecord(recordId) {
  const records = loadRecords().filter((record) => record._id !== recordId);
  saveRecords(records);
  renderTable();
  showStatus("ลบข้อมูลในเครื่องแล้ว");
}

function exportCSV() {
  const records = loadRecords();

  if (records.length === 0) {
    alert("ยังไม่มีข้อมูลสำหรับ Export");
    return;
  }

  const headers = ["ปี", "เดือน", "วัน", "ประเภท", "ยอดที่จ่าย", "หมายเหตุ"];
  const lines = [
    headers.join(","),
    ...records.map((record) => headers.map((header) => escapeCSV(record[header] || "")).join(","))
  ];
  const csvText = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `other-expenses-demo-${getTodayDateString()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function showSuccessModal(row) {
  const summaryFields = ["ปี", "เดือน", "วัน", "ประเภท", "ยอดที่จ่าย", "หมายเหตุ"];
  elements.successSummary.innerHTML = "";

  summaryFields.forEach((field) => {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = field;
    detail.textContent = field === "ยอดที่จ่าย" ? formatAmount(row[field]) : (row[field] || "-");
    elements.successSummary.appendChild(term);
    elements.successSummary.appendChild(detail);
  });

  elements.successModal.classList.remove("hidden");
}

function closeSuccessModal() {
  elements.successModal.classList.add("hidden");
}

function resetForm(options = {}) {
  const currentDate = elements.paymentDate.value;
  clearErrors();
  elements.form.reset();
  elements.paymentDate.value = options.keepDate ? currentDate : getTodayDateString();
  updateNoteHint();
  renderTable();

  if (options.focusType) {
    elements.expenseType.focus();
  }
}

function showStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusError.textContent = "";
}

function showError(message) {
  elements.statusError.textContent = message;
  elements.statusMessage.textContent = "";
}

function clearErrors() {
  Object.values(elements.errors).forEach((errorElement) => {
    errorElement.textContent = "";
  });
  elements.statusError.textContent = "";
}

function setSubmitting(isSubmitting) {
  elements.saveButton.disabled = isSubmitting;
}

function updateNoteHint() {
  const required = isNoteRequired(elements.expenseType.value);
  elements.noteHint.classList.toggle("hidden", !required);
  elements.noteInput.required = required;
}

function clearLocalData() {
  if (!confirm("ต้องการล้างข้อมูลในเครื่องทั้งหมดใช่ไหม?")) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  renderTable();
  showStatus("ล้างข้อมูลในเครื่องทั้งหมดแล้ว");
}

function createRecordId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `record-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createCell(value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function createStatusCell(status) {
  const cell = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = `status-pill status-${status || "failed"}`;
  pill.textContent = STATUS_LABELS[status] || STATUS_LABELS.failed;
  cell.appendChild(pill);
  return cell;
}

function createActionCell(record) {
  const cell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "action-buttons";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "small-button danger-button";
  deleteButton.textContent = "ลบ";
  deleteButton.addEventListener("click", () => deleteRecord(record._id));
  actions.appendChild(deleteButton);

  if (record._syncStatus === "failed") {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "small-button secondary-button";
    retryButton.textContent = "ส่งซ้ำ";
    retryButton.addEventListener("click", () => retryRecord(record._id));
    actions.appendChild(retryButton);
  }

  cell.appendChild(actions);
  return cell;
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return value || "";
  }
  return amount.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function escapeCSV(value) {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
