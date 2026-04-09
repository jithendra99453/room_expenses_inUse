const ROOM_KEY = '1113';
const ROOM_PATH = `rooms/${ROOM_KEY}`;
const defaultCategories = [
  'Food',
  'Groceries',
  'Dining Out',
  'Coffee',
  'Rent',
  'Utilities',
  'Internet',
  'Water',
  'Transport',
  'Gas/Fuel',
  'Travel',
  'Entertainment',
  'Shopping',
  'Medical',
  'Repairs',
  'Gifts',
  'Pets',
  'Other'
];

const firebaseConfig = window.ROOMPAY_FIREBASE_CONFIG || {
  apiKey: 'AIzaSyDMaMYDdPpF4q8kECbNa6d765eUjdK2F9Y',
  authDomain: 'roomexpensetracker-1901d.firebaseapp.com',
  databaseURL: 'https://roomexpensetracker-1901d-default-rtdb.firebaseio.com',
  projectId: 'roomexpensetracker-1901d',
  storageBucket: 'roomexpensetracker-1901d.firebasestorage.app',
  messagingSenderId: '873571717277',
  appId: '1:873571717277:web:eeae463041cc9a220f0474'
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();

function normalizeRoomData(data) {
  const source = data && typeof data === 'object' ? data : {};
  const normalizeMemberMap = (value) => {
    if (Array.isArray(value)) {
      const mapped = {};
      value
        .filter((item) => typeof item === 'string' && item.trim())
        .forEach((item) => {
          mapped[item.trim()] = true;
        });
      return mapped;
    }
    if (value && typeof value === 'object') {
      const mapped = {};
      Object.entries(value).forEach(([key, item]) => {
        if (typeof item === 'string' && item.trim()) {
          mapped[item.trim()] = true;
          return;
        }
        if (item === true && key.trim()) {
          mapped[key.trim()] = true;
          return;
        }
        if (item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim()) {
          mapped[item.name.trim()] = true;
        }
      });
      return mapped;
    }
    return {};
  };

  const normalizeCollection = (value) => {
    if (value && typeof value === 'object') {
      return value;
    }
    return {};
  };

  const members = Object.keys(normalizeMemberMap(source.members)).length
    ? normalizeMemberMap(source.members)
    : normalizeMemberMap(source.roommates);

  return {
    notes: typeof source.notes === 'string' ? source.notes : '',
    members,
    expenses: normalizeCollection(source.expenses),
    deposits: normalizeCollection(source.deposits)
  };
}

document.addEventListener('alpine:init', () => {
  Alpine.data('expenseTracker', () => ({
    isDarkMode: document.documentElement.classList.contains('dark'),
    showSettings: false,
    activeTab: 'home',
    addMode: 'expense',
    transactionTypeFilter: 'expense',
    expenseFilterOption: 'all',
    expenseChartRange: 'daily',
    roommates: [],
    categories: [...defaultCategories],
    expenses: [],
    deposits: [],
    notes: '',
    summary: { totalPot: 0, totalSpent: 0, moneyLeft: 0, byPerson: {} },
    newExpense: { date: '', amount: '', description: '', splitAmong: [], category: 'Food' },
    newDeposit: { date: '', amount: '', depositedBy: '' },
    newRoommateName: '',
    editingRoommate: [],
    editRoommateName: [],
    loadingExpense: false,
    loadingDeposit: false,
    errorMessage: '',
    successMessage: '',
    showDeleteConfirm: false,
    resetConfirmInput: '',
    deleteType: null,
    deleteId: null,
    editingExpenseId: null,
    editingDepositId: null,
    editExpense: { splitAmong: [] },
    editDeposit: {},
    _roomRef: null,
    _expenseChart: null,

    init() {
      const today = this.getTodayDate();
      this.newExpense.date = today;
      this.newDeposit.date = today;
      this.applyTheme();
      this.startListener();
    },

    getLocalYYYYMMDD(dateObj) {
      return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    },

    getTodayDate() {
      return this.getLocalYYYYMMDD(new Date());
    },

    getCurrentTime() {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    },

    formatDateStr(dateStr) {
      if (!dateStr) return '';
      const today = new Date();
      if (dateStr === this.getLocalYYYYMMDD(today)) return 'Today';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (dateStr === this.getLocalYYYYMMDD(yesterday)) return 'Yesterday';
      const txDate = new Date(dateStr);
      return Number.isNaN(txDate.getTime()) ? dateStr : txDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    formatTimeStr(timeStr) {
      if (!timeStr) return '';
      const [hours, minutes] = timeStr.split(':');
      if (hours === undefined || minutes === undefined) return timeStr;
      const date = new Date();
      date.setHours(Number(hours), Number(minutes), 0, 0);
      return Number.isNaN(date.getTime()) ? timeStr : date.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit'
      });
    },

    getTransactionTimestamp(tx) {
      const time = tx.time || '00:00';
      return new Date(`${tx.date}T${time}:00`).getTime();
    },

    getCategoryEmoji(cat) {
      const icons = {
        Food: '🍔',
        Groceries: '🛒',
        'Dining Out': '🍽️',
        Coffee: '☕',
        Rent: '🏠',
        Utilities: '⚡',
        Internet: '🌐',
        Water: '💧',
        Transport: '🚕',
        'Gas/Fuel': '⛽',
        Travel: '✈️',
        Entertainment: '🍿',
        Shopping: '🛍️',
        Medical: '💊',
        Repairs: '🔧',
        Gifts: '🎁',
        Pets: '🐾',
        Other: '💳'
      };
      return icons[cat] || '💳';
    },

    startListener() {
      this._roomRef = db.ref(ROOM_PATH);
      this._roomRef.on('value', (snap) => {
        const data = snap.val();
        if (!data) {
          this._roomRef.set(normalizeRoomData(null));
          return;
        }
        const normalized = normalizeRoomData(data);
        const requiresMigration =
          data.notes !== normalized.notes ||
          !data.members ||
          Array.isArray(data.members) ||
          data.roommates !== undefined ||
          !data.expenses ||
          !data.deposits;

        if (requiresMigration) {
          this._roomRef.update(normalized).catch((error) => {
            this.showError(error?.message || 'Failed to normalize room data.');
          });
        }
        this.applyRoomState(normalized);
      }, (error) => {
        this.showError(error?.message || 'Failed to connect to Firebase. Check your database rules and config.');
      });
    },

    roomRef(path = '') {
      return db.ref(path ? `${ROOM_PATH}/${path}` : ROOM_PATH);
    },

    applyTheme() {
      document.documentElement.classList.toggle('dark', this.isDarkMode);
      document.body.classList.toggle('dark', this.isDarkMode);
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute('content', this.isDarkMode ? '#0f172a' : '#1e1b4b');
      }
      this.refreshExpenseChart();
    },

    toggleDarkMode() {
      this.isDarkMode = !this.isDarkMode;
      localStorage.setItem('darkMode', String(this.isDarkMode));
      this.applyTheme();
    },

    toggleSplit(selectAll) {
      this.newExpense.splitAmong = selectAll ? [...this.roommates] : [];
    },

    formatSplitList(list) {
      if (!list || list.length === 0) return 'Nobody';
      if (this.roommates.length > 0 && list.length === this.roommates.length) return 'Everyone';
      return list.join(', ');
    },

    formatCurrency(amount) {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(Number(amount) || 0);
    },

    setExpenseChartRange(range) {
      this.expenseChartRange = range;
      this.refreshExpenseChart();
    },

    getExpenseChartBucketStart(dateStr) {
      const base = new Date(`${dateStr}T00:00:00`);
      if (Number.isNaN(base.getTime())) return dateStr;

      if (this.expenseChartRange === 'weekly') {
        const day = base.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        base.setDate(base.getDate() + diff);
      }

      if (this.expenseChartRange === 'monthly') {
        base.setDate(1);
      }

      return this.getLocalYYYYMMDD(base);
    },

    formatExpenseChartLabel(bucketStart) {
      const date = new Date(`${bucketStart}T00:00:00`);
      if (Number.isNaN(date.getTime())) return bucketStart;

      if (this.expenseChartRange === 'daily') {
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      }

      if (this.expenseChartRange === 'weekly') {
        const weekEnd = new Date(date);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      }

      return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    },

    get expenseTrendData() {
      const grouped = {};

      this.expenses.forEach((expense) => {
        if (!expense?.date) return;
        const bucket = this.getExpenseChartBucketStart(expense.date);
        grouped[bucket] = (grouped[bucket] || 0) + (Number(expense.amount) || 0);
      });

      const sortedBuckets = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));
      return {
        labels: sortedBuckets.map((bucket) => this.formatExpenseChartLabel(bucket)),
        values: sortedBuckets.map((bucket) => grouped[bucket])
      };
    },

    refreshExpenseChart() {
      if (!this.$refs?.expenseChart || typeof Chart === 'undefined') return;

      const labels = this.expenseTrendData.labels;
      const values = this.expenseTrendData.values;
      const axisColor = this.isDarkMode ? '#94a3b8' : '#64748b';
      const gridColor = this.isDarkMode ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.14)';
      const lineColor = '#e11d48';
      const areaColor = this.isDarkMode ? 'rgba(225, 29, 72, 0.24)' : 'rgba(225, 29, 72, 0.14)';

      if (this._expenseChart) {
        this._expenseChart.destroy();
      }

      this._expenseChart = new Chart(this.$refs.expenseChart, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Expenses',
            data: values,
            borderColor: lineColor,
            backgroundColor: areaColor,
            borderWidth: 3,
            pointRadius: labels.length <= 1 ? 4 : 3,
            pointHoverRadius: 5,
            pointBackgroundColor: lineColor,
            pointBorderWidth: 0,
            tension: 0.35,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: (context) => this.formatCurrency(context.parsed.y || 0)
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: axisColor,
                maxRotation: 0,
                autoSkip: true
              },
              grid: {
                display: false
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: axisColor,
                callback: (value) => this.formatCurrency(value)
              },
              grid: {
                color: gridColor
              }
            }
          }
        }
      });
    },

    showError(message) {
      this.errorMessage = message;
      setTimeout(() => { this.errorMessage = ''; }, 4500);
    },

    showSuccess(message) {
      this.successMessage = message;
      setTimeout(() => { this.successMessage = ''; }, 3000);
    },

    clearErrors() {
      this.errorMessage = '';
      this.successMessage = '';
    },

    get resetConfirmCode() {
      return `RESET ${ROOM_KEY}`;
    },

    buildMembersMap(names) {
      const members = {};
      names.forEach((name) => {
        if (typeof name === 'string' && name.trim()) {
          members[name.trim()] = true;
        }
      });
      return members;
    },

    buildRoomPayload(memberNames) {
      return this.buildFullRoomPayload(memberNames, this.expenses, this.deposits);
    },

    buildFullRoomPayload(memberNames, expenseList, depositList) {
      const expenses = {};
      const deposits = {};

      expenseList.forEach((expense) => {
        if (expense && expense.id) {
          const { id, ...rest } = expense;
          expenses[id] = rest;
        }
      });

      depositList.forEach((deposit) => {
        if (deposit && deposit.id) {
          const { id, ...rest } = deposit;
          deposits[id] = rest;
        }
      });

      return {
        notes: this.notes || '',
        members: this.buildMembersMap(memberNames),
        expenses,
        deposits
      };
    },

    applyRoomState(roomData) {
      const normalized = normalizeRoomData(roomData);
      this.notes = normalized.notes;
      this.roommates = Object.keys(normalized.members);
      this.expenses = Object.entries(normalized.expenses).map(([id, value]) => ({ id, ...value }));
      this.deposits = Object.entries(normalized.deposits).map(([id, value]) => ({ id, ...value }));
      this.editingRoommate = new Array(this.roommates.length).fill(false);
      this.editRoommateName = new Array(this.roommates.length).fill('');
      this.newExpense.splitAmong = this.newExpense.splitAmong.filter((name) => this.roommates.includes(name));
      if (this.newExpense.splitAmong.length === 0 && this.roommates.length > 0) {
        this.newExpense.splitAmong = [...this.roommates];
      }
      if (!this.roommates.includes(this.newDeposit.depositedBy)) {
        this.newDeposit.depositedBy = this.roommates[0] || '';
      }
      this.updateSummary(normalized.expenses, normalized.deposits);
      this.$nextTick(() => this.refreshExpenseChart());
    },

    addRoommate() {
      const name = this.newRoommateName.trim();
      if (!name) {
        this.showError('Enter a member name.');
        return;
      }
      if (this.roommates.some((roommate) => roommate.toLowerCase() === name.toLowerCase())) {
        this.showError('Member name already exists.');
        return;
      }
      if (!this.isValidMemberKey(name)) {
        this.showError('Member name cannot contain . # $ [ ] /');
        return;
      }
      const nextRoom = this.buildRoomPayload([...this.roommates, name]);
      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.newRoommateName = '';
          this.showSuccess('Member added.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to add member.'));
    },

    isValidMemberKey(name) {
      return !/[.#$/\[\]]/.test(name);
    },

    startEditRoommate(index, currentName) {
      this.editingRoommate[index] = true;
      this.editRoommateName[index] = currentName;
    },

    cancelEditRoommate(index) {
      this.editingRoommate[index] = false;
    },

    saveEditRoommate(index, oldName) {
      const newName = (this.editRoommateName[index] || '').trim();
      if (!newName) {
        this.showError('Name cannot be blank.');
        return;
      }
      if (newName !== oldName && this.roommates.some((roommate) => roommate.toLowerCase() === newName.toLowerCase())) {
        this.showError('Member name already exists.');
        return;
      }
      if (!this.isValidMemberKey(newName)) {
        this.showError('Member name cannot contain . # $ [ ] /');
        return;
      }
      const updatedNames = this.roommates.map((roommate, roommateIndex) => roommateIndex === index ? newName : roommate);
      const renamedExpenses = this.expenses.map((expense) => ({
        ...expense,
        splitAmong: (expense.splitAmong || []).map((person) => person === oldName ? newName : person)
      }));
      const renamedDeposits = this.deposits.map((deposit) => ({
        ...deposit,
        depositedBy: deposit.depositedBy === oldName ? newName : deposit.depositedBy
      }));
      const expenses = {};
      const deposits = {};

      renamedExpenses.forEach((expense) => {
        const { id, ...rest } = expense;
        expenses[id] = rest;
      });
      renamedDeposits.forEach((deposit) => {
        const { id, ...rest } = deposit;
        deposits[id] = rest;
      });

      const nextRoom = {
        notes: this.notes || '',
        members: this.buildMembersMap(updatedNames),
        expenses,
        deposits
      };

      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.editingRoommate[index] = false;
          this.showSuccess('Member updated.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to update member.'));
    },

    deleteRoommate(index) {
      const name = this.roommates[index];
      if (this.roommates.length <= 1) {
        this.showError('At least one member is required.');
        this.cancelDelete();
        return;
      }
      const hasExpenses = this.expenses.some((expense) => (expense.splitAmong || []).includes(name));
      const hasDeposits = this.deposits.some((deposit) => deposit.depositedBy === name);
      if (hasExpenses || hasDeposits) {
        this.showError(`Cannot remove ${name}. They already have transaction history.`);
        this.cancelDelete();
        return;
      }

      const updatedNames = this.roommates.filter((_, roommateIndex) => roommateIndex !== index);
      const nextRoom = this.buildRoomPayload(updatedNames);
      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.cancelDelete();
          this.showSuccess('Member removed.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to remove member.'));
    },

    addExpense() {
      if (this.roommates.length === 0) {
        this.showError('Add members first.');
        return;
      }
      if (this.newExpense.splitAmong.length === 0) {
        this.showError('Select at least one member to split the expense.');
        return;
      }
      if (!this.newExpense.description.trim()) {
        this.showError('Description is required.');
        return;
      }
      if (!this.newExpense.amount || this.newExpense.amount <= 0) {
        this.showError('Enter a valid expense amount.');
        return;
      }
      if (!this.newExpense.date) {
        this.showError('Expense date is required.');
        return;
      }

      this.loadingExpense = true;
      const id = this.roomRef('expenses').push().key;
      const payload = {
        id,
        amount: Number(this.newExpense.amount),
        description: this.newExpense.description.trim(),
        category: this.newExpense.category,
        date: this.newExpense.date,
        time: this.getCurrentTime(),
        splitAmong: [...this.newExpense.splitAmong]
      };

      const nextRoom = this.buildFullRoomPayload(this.roommates, [...this.expenses, payload], this.deposits);
      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.newExpense = {
            date: this.getTodayDate(),
            amount: '',
            description: '',
            splitAmong: [...this.roommates],
            category: 'Food'
          };
          this.showSuccess('Expense added.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to add expense.'))
        .finally(() => { this.loadingExpense = false; });
    },

    addDeposit() {
      if (this.roommates.length === 0) {
        this.showError('Add members first.');
        return;
      }
      if (!this.newDeposit.depositedBy) {
        this.showError('Choose who deposited the money.');
        return;
      }
      if (!this.newDeposit.amount || this.newDeposit.amount <= 0) {
        this.showError('Enter a valid deposit amount.');
        return;
      }
      if (!this.newDeposit.date) {
        this.showError('Deposit date is required.');
        return;
      }

      this.loadingDeposit = true;
      const id = this.roomRef('deposits').push().key;
      const payload = {
        id,
        amount: Number(this.newDeposit.amount),
        depositedBy: this.newDeposit.depositedBy,
        date: this.newDeposit.date,
        time: this.getCurrentTime()
      };

      const nextRoom = this.buildFullRoomPayload(this.roommates, this.expenses, [...this.deposits, payload]);
      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.newDeposit = {
            date: this.getTodayDate(),
            amount: '',
            depositedBy: this.roommates[0] || ''
          };
          this.showSuccess('Deposit added.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to add deposit.'))
        .finally(() => { this.loadingDeposit = false; });
    },

    startEditExpense(expense) {
      this.editingExpenseId = expense.id;
      this.editExpense = JSON.parse(JSON.stringify(expense));
      this.editExpense.splitAmong = this.editExpense.splitAmong || [];
    },

    cancelEditExpense() {
      this.editingExpenseId = null;
    },

    saveEditExpense(id) {
      if (!this.editExpense.description.trim()) {
        this.showError('Description is required.');
        return;
      }
      if (!this.editExpense.amount || this.editExpense.amount <= 0) {
        this.showError('Enter a valid expense amount.');
        return;
      }
      if (!this.editExpense.date) {
        this.showError('Expense date is required.');
        return;
      }
      if (!this.editExpense.time) {
        this.showError('Expense time is required.');
        return;
      }
      if (!this.editExpense.splitAmong || this.editExpense.splitAmong.length === 0) {
        this.showError('Select at least one member to split the expense.');
        return;
      }

      const updatedExpenses = this.expenses.map((expense) => expense.id === id ? {
        ...expense,
        amount: Number(this.editExpense.amount),
        description: this.editExpense.description.trim(),
        category: this.editExpense.category,
        date: this.editExpense.date,
        time: this.editExpense.time || '00:00',
        splitAmong: [...this.editExpense.splitAmong]
      } : expense);

      const nextRoom = this.buildFullRoomPayload(this.roommates, updatedExpenses, this.deposits);
      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.editingExpenseId = null;
          this.showSuccess('Expense updated.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to update expense.'));
    },

    startEditDeposit(deposit) {
      this.editingDepositId = deposit.id;
      this.editDeposit = JSON.parse(JSON.stringify(deposit));
    },

    cancelEditDeposit() {
      this.editingDepositId = null;
    },

    saveEditDeposit(id) {
      if (!this.editDeposit.depositedBy) {
        this.showError('Choose who deposited the money.');
        return;
      }
      if (!this.editDeposit.amount || this.editDeposit.amount <= 0) {
        this.showError('Enter a valid deposit amount.');
        return;
      }
      if (!this.editDeposit.date) {
        this.showError('Deposit date is required.');
        return;
      }
      if (!this.editDeposit.time) {
        this.showError('Deposit time is required.');
        return;
      }

      const updatedDeposits = this.deposits.map((deposit) => deposit.id === id ? {
        ...deposit,
        amount: Number(this.editDeposit.amount),
        depositedBy: this.editDeposit.depositedBy,
        date: this.editDeposit.date,
        time: this.editDeposit.time || '00:00'
      } : deposit);

      const nextRoom = this.buildFullRoomPayload(this.roommates, this.expenses, updatedDeposits);
      this.roomRef().set(nextRoom)
        .then(() => {
          this.applyRoomState(nextRoom);
          this.editingDepositId = null;
          this.showSuccess('Deposit updated.');
        })
        .catch((error) => this.showError(error?.message || 'Failed to update deposit.'));
    },

    confirmDelete(type, id = null) {
      this.deleteType = type;
      this.deleteId = id;
      this.resetConfirmInput = '';
      this.showDeleteConfirm = true;
    },

    cancelDelete() {
      this.showDeleteConfirm = false;
      this.resetConfirmInput = '';
      this.deleteType = null;
      this.deleteId = null;
    },

    executeDelete() {
      if (this.deleteType === 'member') {
        this.deleteRoommate(this.deleteId);
        return;
      }
      if (this.deleteType === 'expense') {
        const updatedExpenses = this.expenses.filter((expense) => expense.id !== this.deleteId);
        const nextRoom = this.buildFullRoomPayload(this.roommates, updatedExpenses, this.deposits);
        this.roomRef().set(nextRoom)
          .then(() => {
            this.applyRoomState(nextRoom);
            this.cancelDelete();
            this.showSuccess('Expense deleted.');
          })
          .catch((error) => this.showError(error?.message || 'Failed to delete expense.'));
        return;
      }
      if (this.deleteType === 'deposit') {
        const updatedDeposits = this.deposits.filter((deposit) => deposit.id !== this.deleteId);
        const nextRoom = this.buildFullRoomPayload(this.roommates, this.expenses, updatedDeposits);
        this.roomRef().set(nextRoom)
          .then(() => {
            this.applyRoomState(nextRoom);
            this.cancelDelete();
            this.showSuccess('Deposit deleted.');
          })
          .catch((error) => this.showError(error?.message || 'Failed to delete deposit.'));
        return;
      }
      if (this.deleteType === 'resetAll') {
        if (this.resetConfirmInput.trim() !== this.resetConfirmCode) {
          this.showError(`Enter ${this.resetConfirmCode} to clear all room data.`);
          return;
        }
        const nextRoom = { notes: '', members: {}, expenses: {}, deposits: {} };
        this.roomRef().set(nextRoom)
          .then(() => {
            this.applyRoomState(nextRoom);
            this.cancelDelete();
            this.showSuccess('Room data cleared.');
          })
          .catch((error) => this.showError(error?.message || 'Failed to clear room data.'));
      }
    },

    updateSummary(expenses, deposits) {
      const summary = { totalPot: 0, totalSpent: 0, moneyLeft: 0, byPerson: {} };

      this.roommates.forEach((person) => {
        summary.byPerson[person] = { deposited: 0, expenseShare: 0, balance: 0 };
      });

      Object.values(deposits).forEach((deposit) => {
        const amount = Number(deposit.amount) || 0;
        summary.totalPot += amount;
        if (deposit.depositedBy && summary.byPerson[deposit.depositedBy]) {
          summary.byPerson[deposit.depositedBy].deposited += amount;
        }
      });

      Object.values(expenses).forEach((expense) => {
        const amount = Number(expense.amount) || 0;
        const splitAmong = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
        if (splitAmong.length === 0) return;
        summary.totalSpent += amount;
        const share = amount / splitAmong.length;
        splitAmong.forEach((person) => {
          if (summary.byPerson[person]) {
            summary.byPerson[person].expenseShare += share;
          }
        });
      });

      this.roommates.forEach((person) => {
        summary.byPerson[person].balance = summary.byPerson[person].deposited - summary.byPerson[person].expenseShare;
      });

      summary.moneyLeft = summary.totalPot - summary.totalSpent;
      this.summary = summary;
    },

    get groupedFilteredTransactions() {
      const txs = [];

      if (this.transactionTypeFilter === 'expense') {
        this.expenses.forEach((expense) => {
          if (this.expenseFilterOption === 'all' || (expense.splitAmong || []).includes(this.expenseFilterOption)) {
            txs.push({ ...expense, type: 'expense' });
          }
        });
      } else {
        this.deposits.forEach((deposit) => {
          if (this.expenseFilterOption === 'all' || deposit.depositedBy === this.expenseFilterOption) {
            txs.push({ ...deposit, type: 'deposit' });
          }
        });
      }

      txs.sort((a, b) => this.getTransactionTimestamp(b) - this.getTransactionTimestamp(a) || String(b.id).localeCompare(String(a.id)));

      const grouped = {};
      txs.forEach((tx) => {
        if (!grouped[tx.date]) {
          grouped[tx.date] = { date: tx.date, items: [], total: 0 };
        }
        grouped[tx.date].items.push(tx);
        grouped[tx.date].total += Number(tx.amount) || 0;
      });

      return Object.values(grouped).sort((a, b) => new Date(b.date) - new Date(a.date));
    }
  }));
});
