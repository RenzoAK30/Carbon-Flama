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
let dishPendingMod = null; // Plato seleccionado temporalmente para el modal de modificadores

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
    renderCajaView();
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
        renderAdminMenuCategories();
        renderAdminMesas();
        renderCajaView();
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

    switchRoleView(perfil.rol);
}

function handleLogout() {
    localStorage.removeItem('cf_user');
    location.reload();
}

function switchRoleView(role) {
    currentRole = role;
    document.querySelectorAll('.role-view').forEach(el => el.classList.remove('active'));
    
    let vistaId = `view-${role}`;
    const target = document.getElementById(vistaId);
    if (target) {
        target.classList.add('active');
        if (role === 'caja') renderCajaView();
    } else {
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
        // Al hacer clic, abre la ventana emergente de modificadores
        div.onclick = () => openModModal({ ...dish, price: currentPrice });
        grid.appendChild(div);
    });
}

// ==================== MODAL DE MODIFICADORES (VENTANA EMERGENTE) ====================
function openModModal(dish) {
    dishPendingMod = dish;
    document.getElementById('modalDishName').innerText = dish.name;
    document.getElementById('modalDishCategory').innerText = `Categoría: ${dish.category} - Base: S/ ${dish.price.toFixed(2)}`;
    document.getElementById('modalComment').value = '';

    const container = document.getElementById('modifiersContainer');
    container.innerHTML = '';

    let optionsHtml = '';
    if (dish.category === 'Parrillas') {
        optionsHtml = `
            <label class="modifier-option"><input type="radio" name="modOption" value="Original" checked> Original (+ S/ 0.00)</label>
            <label class="modifier-option"><input type="radio" name="modOption" value="Arroz blanco"> Arroz blanco (+ S/ 3.00)</label>
            <label class="modifier-option"><input type="radio" name="modOption" value="Arroz Chaufa"> Arroz Chaufa (+ S/ 5.00)</label>
        `;
    } else if (dish.category === 'Cenas') {
        optionsHtml = `
            <label class="modifier-option"><input type="radio" name="modOption" value="Original" checked> Original (+ S/ 0.00)</label>
            <label class="modifier-option"><input type="radio" name="modOption" value="Arroz Chaufa"> Arroz Chaufa (+ S/ 3.00)</label>
        `;
    } else {
        optionsHtml = `<p class="text-muted">Este producto no requiere modificadores de acompañamiento.</p>`;
    }

    container.innerHTML = optionsHtml;
    document.getElementById('modModal').classList.remove('hidden');
}

function closeModModal() {
    document.getElementById('modModal').classList.add('hidden');
    dishPendingMod = null;
}

function confirmAddToCart() {
    if (!dishPendingMod) return;

    let extraPrice = 0;
    let selectedOptionName = 'Original';

    const selectedRadio = document.querySelector('input[name="modOption"]:checked');
    if (selectedRadio) {
        selectedOptionName = selectedRadio.value;
        if (selectedOptionName === 'Arroz blanco') extraPrice = 3.00;
        if (selectedOptionName === 'Arroz Chaufa') {
            extraPrice = dishPendingMod.category === 'Parrillas' ? 5.00 : 3.00;
        }
    }

    const comment = document.getElementById('modalComment').value.trim();
    
    let finalItemName = dishPendingMod.name;
    if (selectedOptionName !== 'Original') {
        finalItemName += ` (${selectedOptionName})`;
    }
    if (comment) {
        finalItemName += ` [Nota: ${comment}]`;
    }

    const finalPrice = dishPendingMod.price + extraPrice;

    currentOrder.push({
        name: finalItemName,
        price: finalPrice
    });

    updateCartUI();
    closeModModal();
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
    if (totalEl) totalEl.innerText = `S/ ${subtotal.toFixed(2)}`;
}

// ==================== CARTA ACTIVA CON SWITCH DESLIZABLE ====================
function toggleCartaFestiva(isFestiva) {
    isCartaFestiva = isFestiva;
    const lblNormal = document.getElementById('lblCartaNormal');
    const lblFestiva = document.getElementById('lblCartaFestiva');

    if (isFestiva) {
        lblNormal.classList.remove('active');
        lblFestiva.classList.add('active');
    } else {
        lblFestiva.classList.remove('active');
        lblNormal.classList.add('active');
    }

    renderDishes('Todas');
}

// ==================== VISTA CAJA (DISEÑO SOLICITADO) ====================
function renderCajaView() {
    const grid = document.getElementById('cajaCardsGrid');
    if (!grid) return;

    // Datos simulados en tiempo real alineados al diseño de referencia
    const activeTickets = [
        { id: 2, type: 'salon', name: 'Mesa 2', time: '09:26 p. m.', total: 22.00, tapers: 0 },
        { id: 15, type: 'salon', name: 'Mesa 15', time: '07:50 p. m.', total: 212.00, tapers: 13 },
        { id: 100, type: 'llevar', name: 'Para Llevar', time: '10:39 p. m.', total: 17.00, tapers: 2 },
        { id: 1, type: 'salon', name: 'Mesa 1', time: '11:19 p. m.', total: 5.00, tapers: 0 }
    ];

    let salonCount = activeTickets.filter(t => t.type === 'salon').length;
    let llevarCount = activeTickets.filter(t => t.type === 'llevar').length;
    let totalCobrar = activeTickets.reduce((acc, t) => acc + t.total, 0);

    document.getElementById('cajaTotalCuentas').innerText = activeTickets.length;
    document.getElementById('cajaSalonLlevar').innerText = `${salonCount} / ${llevarCount}`;
    document.getElementById('cajaPorCobrar').innerText = `S/ ${totalCobrar.toFixed(2)}`;

    grid.innerHTML = '';
    activeTickets.forEach(ticket => {
        const div = document.createElement('div');
        div.className = 'caja-ticket-card';
        div.innerHTML = `
            <div class="ticket-header">
                <span>🍽️ ${ticket.name}</span>
            </div>
            <div class="ticket-time">Abierta ${ticket.time}</div>
            <div class="ticket-price">S/ ${ticket.total.toFixed(2)}</div>
            ${ticket.tapers > 0 ? `<div class="taper-badge">Táper × ${ticket.tapers}</div>` : ''}
        `;
        grid.appendChild(div);
    });
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

// ==================== CARTA ADMINISTRADOR SEPARADA POR CATEGORÍAS ====================
function renderAdminMenuCategories() {
    const container = document.getElementById('adminMenuCategoriesContainer');
    if (!container) return;
    container.innerHTML = '';

    const categoriasUnicas = ['Parrillas', 'Cenas', 'Selvaticos', 'Guarniciones', 'Bebidas'];

    categoriasUnicas.forEach(cat => {
        const platosCat = dishes.filter(d => d.category === cat);
        
        let itemsHtml = '';
        if (platosCat.length === 0) {
            itemsHtml = `<p class="text-muted" style="padding: 0.5rem 0;">No hay productos en esta categoría.</p>`;
        } else {
            platosCat.forEach(d => {
                itemsHtml += `
                    <div class="menu-item-row">
                        <span>${d.name}</span>
                        <div style="text-align: right;">
                            <span class="menu-item-prices">S/ ${d.price.toFixed(2)}</span>
                            <div class="menu-item-fest">Fest. S/ ${d.festivo.toFixed(2)}</div>
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML += `
            <div class="admin-category-section">
                <div class="admin-category-title">
                    <span>${cat}</span>
                    <span class="text-muted" style="font-size:0.85rem;">${platosCat.length} ítems</span>
                </div>
                ${itemsHtml}
            </div>
        `;
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