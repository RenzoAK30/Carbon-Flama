// Configuración de Supabase
const SUPABASE_URL = 'https://vticelayfgcpbrvhjmsy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0aWNlbGF5ZmdjcGJydmhqbXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTkzNzksImV4cCI6MjEwODY5NTM3OX0.BaA9zKh1shxkUoa1zm6ReBVemOIOw1iyX97EdPOkZHs';

window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = window.supabaseClient;

let currentRole = 'mesero';
let isCartaFestiva = false;

let tables = [];
let dishes = [];

let currentOrder = [];
let selectedTable = null;

document.addEventListener('DOMContentLoaded', () => {
    const loggedUser = localStorage.getItem('cf_user');
    if (loggedUser) {
        try {
            const perfil = JSON.parse(loggedUser);
            activarSesion(perfil);
        } catch (e) {
            localStorage.removeItem('cf_user');
        }
    }

    cargarDatosDesdeSupabase();
    loadFinanzasData();
});

// Cargar mesas y platos dinámicamente desde Supabase
async function cargarDatosDesdeSupabase() {
    try {
        const { data: dbMesas, error: errMesas } = await db.from('mesas').select('*');
        if (!errMesas && dbMesas) {
            tables = dbMesas.map(m => ({ id: m.id, name: m.nombre, status: m.status || 'free' }));
        }

        const { data: dbPlatos, error: errPlatos } = await db.from('platos').select('*');
        if (!errPlatos && dbPlatos) {
            dishes = dbPlatos.map(p => ({
                id: p.id,
                name: p.nombre,
                category: p.categoria,
                price: parseFloat(p.precio),
                festivo: parseFloat(p.festivo)
            }));
        }

        renderTables();
        renderDishes('Todas');
        renderAdminMenu();
        renderAdminMesas();
    } catch (err) {
        console.error("Error cargando datos de Supabase:", err);
    }
}

// Autenticación por Nombre de Usuario
async function handleLogin(event) {
    if (event) event.preventDefault();
    
    const usuarioInput = document.getElementById('loginUsername').value.trim();
    const passwordInput = document.getElementById('loginPassword').value.trim();

    if (!usuarioInput || !passwordInput) {
        alert('Por favor completa todos los campos.');
        return;
    }

    try {
        const { data, error } = await db
            .from('usuarios')
            .select('*')
            .ilike('usuario', usuarioInput);

        if (error) {
            alert('Error al consultar la base de datos: ' + error.message);
            return;
        }

        if (!data || data.length === 0) {
            alert('El usuario "' + usuarioInput + '" no existe en la base de datos.');
            return;
        }

        const perfil = data[0];

        if (String(perfil.password).trim() !== String(passwordInput).trim()) {
            alert('Contraseña incorrecta.');
            return;
        }

        if (!perfil.activo) {
            alert('Tu cuenta se encuentra desactivada.');
            return;
        }

        localStorage.setItem('cf_user', JSON.stringify(perfil));
        activarSesion(perfil);

    } catch (err) {
        alert('Ocurrió un error inesperado: ' + err.message);
    }
}

function activarSesion(perfil) {
    const loginView = document.getElementById('loginView');
    const appView = document.getElementById('appView');
    
    if (loginView) loginView.classList.add('hidden');
    if (appView) appView.classList.remove('hidden');
    
    const userNameEl = document.getElementById('loggedUserName');
    if (userNameEl) {
        userNameEl.innerText = `${perfil.nombre_completo} (${perfil.rol.toUpperCase()})`;
    }

    // Asignar automáticamente la vista según el rol devuelto por la base de datos
    switchRoleView(perfil.rol);
}

function handleLogout() {
    localStorage.removeItem('cf_user');
    location.reload();
}

function switchRoleView(role) {
    currentRole = role;
    document.querySelectorAll('.role-view').forEach(el => el.classList.remove('active'));
    
    // Mapeo directo del rol del usuario a su respectiva vista
    let vistaId = `view-${role}`;
    
    // Si el rol es admin, activamos la vista de administración
    const target = document.getElementById(vistaId);
    if (target) {
        target.classList.add('active');
    } else {
        // Por defecto si hay discrepancia, muestra mesero
        const defaultView = document.getElementById('view-mesero');
        if(defaultView) defaultView.classList.add('active');
    }
}

function switchAdminTab(tabName, event) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
    if (event) event.currentTarget.classList.add('active');
    const pane = document.getElementById(`adminTab-${tabName}`);
    if (pane) pane.classList.add('active');
}

function renderTables() {
    const grid = document.getElementById('tablesGrid');
    if (!grid) return;
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
    selectedTable = table;
    const orderSec = document.getElementById('orderSection');
    if (orderSec) orderSec.classList.remove('hidden');
    const title = document.getElementById('currentOrderTitle');
    if (title) title.innerText = `Tomando Pedido - ${table.name}`;
}

function closeOrderSection() {
    const orderSec = document.getElementById('orderSection');
    if (orderSec) orderSec.classList.add('hidden');
}

function filterCategory(cat) { renderDishes(cat); }

function renderDishes(cat) {
    const grid = document.getElementById('dishesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const filtered = cat === 'Todas' ? dishes : dishes.filter(d => d.category === cat);
    
    filtered.forEach(dish => {
        const currentPrice = isCartaFestiva ? (dish.festivo || dish.price) : dish.price;
        const div = document.createElement('div');
        div.className = 'dish-card';
        div.innerHTML = `<h5>${dish.name}</h5><p>S/ ${currentPrice.toFixed(2)}</p>`;
        div.onclick = () => addToCart({ ...dish, price: currentPrice });
        grid.appendChild(div);
    });
}

function addToCart(dish) {
    currentOrder.push(dish);
    updateCartUI();
}

function updateCartUI() {
    const itemsContainer = document.getElementById('cartItems');
    if (!itemsContainer) return;
    itemsContainer.innerHTML = '';
    let subtotal = 0;
    currentOrder.forEach(item => {
        subtotal += item.price;
        itemsContainer.innerHTML += `<div>${item.name} - S/ ${item.price.toFixed(2)}</div>`;
    });
    const subTotalEl = document.getElementById('cartSubtotal');
    const totalEl = document.getElementById('cartTotal');
    if (subTotalEl) subTotalEl.innerText = `S/ ${subtotal.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `S/ ${total.toFixed(2)}`;
}

function toggleCartaFestiva(isFestiva) {
    isCartaFestiva = isFestiva;
    const lbl = document.getElementById('lblCartaStatus');
    if (lbl) lbl.innerText = isFestiva ? 'FESTIVA' : 'NORMAL';
    renderDishes('Todas');
}

async function registrarGasto(event) {
    event.preventDefault();
    const categoria = document.getElementById('gastoCategoria').value;
    const descripcion = document.getElementById('gastoDesc').value;
    const monto = parseFloat(document.getElementById('gastoMonto').value);

    await db.from('gastos').insert([{ categoria, descripcion, monto }]);
    alert('Gasto registrado con éxito');
    loadFinanzasData();
}

async function loadFinanzasData() {
    const { data: gastos } = await db.from('gastos').select('*');
    if (gastos) {
        let totalGastos = gastos.reduce((acc, g) => acc + g.monto, 0);
        const kpi = document.getElementById('kpiGastosTotal');
        if (kpi) kpi.innerText = `S/ ${totalGastos.toFixed(2)}`;
    }
}

async function agregarPlato(event) {
    event.preventDefault();
    const nombre = document.getElementById('platoNombre').value;
    const precio = parseFloat(document.getElementById('platoPrecio').value);
    const festivoVal = document.getElementById('platoFestivo').value;
    const festivo = festivoVal ? parseFloat(festivoVal) : precio;
    const categoria = document.getElementById('platoCategoria').value;

    const { error } = await db.from('platos').insert([{ nombre, categoria, precio, festivo }]);
    if (error) {
        alert('Error al agregar plato: ' + error.message);
    } else {
        alert('Plato agregado correctamente');
        document.getElementById('formPlato').reset();
        cargarDatosDesdeSupabase();
    }
}

function renderAdminMenu() {
    const container = document.getElementById('adminMenuListContainer');
    if (!container) return;
    container.innerHTML = '';
    dishes.forEach(d => {
        container.innerHTML += `<div class="form-card"><strong>${d.name}</strong> - Normal: S/${d.price} | Festivo: S/${d.festivo} (${d.category})</div>`;
    });
}

function renderAdminMesas() {
    const grid = document.getElementById('adminTablesGrid');
    if (grid) {
        grid.innerHTML = '';
        tables.forEach(t => {
            grid.innerHTML += `<div class="table-card"><h4>${t.name}</h4><button class="btn btn-secondary btn-sm" onclick="eliminarMesa(${t.id})">🗑️</button></div>`;
        });
    }
}

async function agregarMesaSalon() {
    const num = document.getElementById('nuevaMesaNum').value;
    if (num) {
        const nombre = `Mesa ${num}`;
        const { error } = await db.from('mesas').insert([{ nombre, status: 'free' }]);
        if (error) {
            alert('Error al agregar mesa: ' + error.message);
        } else {
            document.getElementById('nuevaMesaNum').value = '';
            cargarDatosDesdeSupabase();
        }
    }
}

async function eliminarMesa(id) {
    const { error } = await db.from('mesas').delete().eq('id', id);
    if (error) {
        alert('Error al eliminar mesa: ' + error.message);
    } else {
        cargarDatosDesdeSupabase();
    }
}

async function crearUsuarioTrabajador(e) {
    e.preventDefault();
    const usuario = document.getElementById('usrUser').value;
    const nombre_completo = document.getElementById('usrNombre').value;
    const password = document.getElementById('usrPass').value;
    const rol = document.getElementById('usrRol').value;

    const { error } = await db.from('usuarios').insert([{ usuario, nombre_completo, password, rol, activo: true }]);
    if (error) {
        alert('Error al crear usuario: ' + error.message);
    } else {
        alert('Trabajador creado con éxito.');
        e.target.reset();
    }
}