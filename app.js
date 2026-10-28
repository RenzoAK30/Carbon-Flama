// Configuración de Supabase
const SUPABASE_URL = 'https://vticelayfgcpbrvhjmsy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0aWNlbGF5ZmdjcGJydmhqbXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTkzNzksImV4cCI6MjEwODY5NTM3OX0.BaA9zKh1shxkUoa1zm6ReBVemOIOw1iyX97EdPOkZHs';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Estado Global
let currentRole = 'mesero';
let tables = [
    { id: 1, name: 'Mesa 1', status: 'free' },
    { id: 2, name: 'Mesa 2', status: 'occupied' },
    { id: 3, name: 'Mesa 3', status: 'free' },
    { id: 4, name: 'Mesa 4', status: 'free' }
];

let dishes = [
    { id: 101, name: 'Parrilla Personal', category: 'Parrillas', price: 35.00, sideOptions: ['Papas + Ensalada', 'Arroz Blanco (+S/2.00)', 'Arroz Chaufa (+S/4.00)'] },
    { id: 102, name: 'Churrasco Prime', category: 'Parrillas', price: 42.00, sideOptions: ['Papas + Ensalada', 'Arroz Chaufa (+S/4.00)'] },
    { id: 103, name: 'Cena Cecina con Tacacho', category: 'Cenas', price: 30.00, sideOptions: ['Normal', 'Arroz Chaufa (+S/3.00)'] },
    { id: 104, name: 'Inca Kola 1.5L', category: 'Bebidas', price: 12.00 }
];

let currentOrder = [];
let selectedTable = null;
let isJoiningMode = false;
let selectedTablesToJoin = [];

document.addEventListener('DOMContentLoaded', () => {
    renderTables();
    renderDishes('Todas');
    loadFinanzasData();
});

// Cambiar de Rol
function switchRole(role) {
    currentRole = role;
    document.querySelectorAll('.role-view').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${role}`).classList.add('active');
}

// Renderizar Mapa de Mesas
function renderTables() {
    const grid = document.getElementById('tablesGrid');
    grid.innerHTML = '';
    tables.forEach(table => {
        const div = document.createElement('div');
        div.className = `table-card ${table.status}`;
        div.innerHTML = `<h4>${table.name}</h4><p>${table.status === 'free' ? 'Libre' : 'Ocupada'}</p>`;
        div.onclick = () => handleTableClick(table);
        grid.appendChild(div);
    });
}

function handleTableClick(table) {
    if (isJoiningMode) {
        selectedTablesToJoin.push(table.id);
        alert(`Mesa ${table.name} seleccionada para unión.`);
        return;
    }
    selectedTable = table;
    document.getElementById('orderSection').classList.remove('hidden');
    document.getElementById('currentOrderTitle').innerText = `Tomando Pedido - ${table.name}`;
}

// Filtrar Platos
function filterCategory(cat) {
    renderDishes(cat);
}

function renderDishes(cat) {
    const grid = document.getElementById('dishesGrid');
    grid.innerHTML = '';
    const filtered = cat === 'Todas' ? dishes : dishes.filter(d => d.category === cat);
    
    filtered.forEach(dish => {
        const div = document.createElement('div');
        div.className = 'dish-card';
        div.innerHTML = `<h5>${dish.name}</h5><p>S/ ${dish.price.toFixed(2)}</p>`;
        div.onclick = () => addToCart(dish);
        grid.appendChild(div);
    });
}

function addToCart(dish) {
    currentOrder.push(dish);
    updateCartUI();
}

function updateCartUI() {
    const itemsContainer = document.getElementById('cartItems');
    itemsContainer.innerHTML = '';
    let subtotal = 0;

    currentOrder.forEach((item, index) => {
        subtotal += item.price;
        const div = document.createElement('div');
        div.innerText = `${item.name} - S/ ${item.price.toFixed(2)}`;
        itemsContainer.appendChild(div);
    });

    document.getElementById('cartSubtotal').innerText = `S/ ${subtotal.toFixed(2)}`;
    document.getElementById('cartTotal').innerText = `S/ ${subtotal.toFixed(2)}`;
}

// Registrar Gastos y Conexión con Supabase
async function registrarGasto(event) {
    event.preventDefault();
    const categoria = document.getElementById('gastoCategoria').value;
    const descripcion = document.getElementById('gastoDesc').value;
    const monto = parseFloat(document.getElementById('gastoMonto').value);

    const { data, error } = await supabase.from('gastos').insert([{ categoria, descripcion, monto }]);

    if (error) {
        console.error('Error insertando gasto:', error);
        alert('Ocurrió un error al registrar el gasto en Supabase.');
    } else {
        alert('Gasto registrado con éxito');
        loadFinanzasData();
    }
}

async function loadFinanzasData() {
    const { data: gastos } = await supabase.from('gastos').select('*');
    if (gastos) {
        const tbody = document.getElementById('gastosTableBody');
        tbody.innerHTML = '';
        let totalGastos = 0;
        gastos.forEach(g => {
            totalGastos += g.monto;
            tbody.innerHTML += `<tr><td>${g.fecha || 'Hoy'}</td><td>${g.categoria}</td><td>${g.descripcion}</td><td>S/ ${g.monto.toFixed(2)}</td></tr>`;
        });
        document.getElementById('kpiGastosTotal').innerText = `S/ ${totalGastos.toFixed(2)}`;
    }
}
