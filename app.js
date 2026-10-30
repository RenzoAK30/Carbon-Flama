// Configuración de Supabase
const SUPABASE_URL = 'https://vticelayfgcpbrvhjmsy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0aWNlbGF5ZmdjcGJydmhqbXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTkzNzksImV4cCI6MjEwODY5NTM3OX0.BaA9zKh1shxkUoa1zm6ReBVemOIOw1iyX97EdPOkZHs';

window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = window.supabaseClient;

let currentRole = 'mesero';
let isCartaFestiva = false;

let tables = [];
let dishes = [];
let activeOrders = {}; // Memoria local de comandas por mesa/delivery
let kitchenOrders = []; // Comandas enviadas a cocina
let isJoinMode = false;
let tablesToJoin = [];

let selectedTable = null;
let dishPendingMod = null;

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
        renderKitchenView();
    } catch (err) {
        console.error("Error cargando datos de Supabase:", err);
    }
}

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
        if (role === 'cocina') renderKitchenView();
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

// ==================== MAPA DE MESAS Y MODO UNIR ====================
function renderTables() {
    const grid = document.getElementById('tablesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    tables.forEach(table => {
        const div = document.createElement('div');
        div.className = `table-card ${table.status}`;
        if (tablesToJoin.includes(table.id)) div.classList.add('selected-join');

        div.innerHTML = `<h4>${table.name}</h4><p>${table.status === 'free' ? 'Libre' : 'Ocupada'}</p>`;
        div.onclick = () => {
            if (isJoinMode) {
                toggleSelectTableToJoin(table.id);
            } else {
                handleTableClick(table.name);
            }
        };
        grid.appendChild(div);
    });
}

function toggleJoinTablesMode() {
    isJoinMode = !isJoinMode;
    tablesToJoin = [];
    const btn = document.getElementById('btnJoinMode');
    if (isJoinMode) {
        btn.style.background = 'var(--accent-yellow)';
        btn.style.color = '#000';
        alert('Selecciona 2 o más mesas para unirlas.');
    } else {
        btn.style.background = '';
        btn.style.color = '';
    }
    renderTables();
}

function toggleSelectTableToJoin(id) {
    if (tablesToJoin.includes(id)) {
        tablesToJoin = tablesToJoin.filter(t => t.id !== id);
    } else {
        tablesToJoin.push(id);
    }
    if (tablesToJoin.length >= 2) {
        const names = tables.filter(t => tablesToJoin.includes(t.id)).map(t => t.name).join(' + ');
        alert(`Mesas unidas correctamente: ${names}`);
        isJoinMode = false;
        tablesToJoin = [];
        const btn = document.getElementById('btnJoinMode');
        btn.style.background = '';
        btn.style.color = '';
    }
    renderTables();
}

function openTakeoutView() {
    const deliveryName = "Delivery / Para Llevar #" + (Math.floor(Math.random() * 900) + 100);
    handleTableClick(deliveryName);
}

// ==================== TOMA DE PEDIDOS Y PERSISTENCIA POR MESA ====================
function handleTableClick(tableName) {
    selectedTable = tableName;

    // Si la mesa no tiene comanda iniciada, la inicializamos vacía
    if (!activeOrders[selectedTable]) {
        activeOrders[selectedTable] = [];
    }

    document.getElementById('salonMapSection').classList.add('hidden');
    document.getElementById('orderSection').classList.remove('hidden');

    document.getElementById('currentOrderTitle').innerText = selectedTable;
    document.getElementById('cartTableTitle').innerText = selectedTable;
    updateCartUI();
}

function closeOrderSection() {
    document.getElementById('orderSection').classList.add('hidden');
    document.getElementById('salonMapSection').classList.remove('hidden');
    selectedTable = null;
    renderTables();
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
        div.onclick = () => openModModal({ ...dish, price: currentPrice });
        grid.appendChild(div);
    });
}

// ==================== MODAL DE MODIFICADORES ====================
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
    if (!dishPendingMod || !selectedTable) return;

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

    // Añadir a la comanda activa de la mesa en memoria
    if (!activeOrders[selectedTable]) activeOrders[selectedTable] = [];
    activeOrders[selectedTable].push({
        name: finalItemName,
        price: finalPrice
    });

    // Cambiar estado de mesa a ocupada si pertenece al salón
    const tableObj = tables.find(t => t.name === selectedTable);
    if (tableObj) {
        tableObj.status = 'occupied';
    }

    updateCartUI();
    closeModModal();
}

function updateCartUI() {
    const itemsContainer = document.getElementById('cartItems');
    if (!itemsContainer || !selectedTable) return;
    
    const currentOrder = activeOrders[selectedTable] || [];

    if (currentOrder.length === 0) {
        itemsContainer.innerHTML = `<p class="empty-msg">Sin ítems aún.</p>`;
    } else {
        itemsContainer.innerHTML = '';
        currentOrder.forEach((item, index) => {
            itemsContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span>${item.name} - S/ ${item.price.toFixed(2)}</span>
                    <button class="btn btn-secondary btn-sm" onclick="removeItemFromOrder(${index})" style="padding:0.1rem 0.4rem; font-size:0.7rem;">✕</button>
                </div>
            `;
        });
    }

    let subtotal = currentOrder.reduce((acc, item) => acc + item.price, 0);
    const totalEl = document.getElementById('cartTotal');
    if (totalEl) totalEl.innerText = `S/ ${subtotal.toFixed(2)}`;
}

function removeItemFromOrder(index) {
    if (!selectedTable) return;
    activeOrders[selectedTable].splice(index, 1);
    updateCartUI();
}

// ==================== ENVIAR A COCINA ====================
function enviarPedidoACocina() {
    if (!selectedTable || !activeOrders[selectedTable] || activeOrders[selectedTable].length === 0) {
        alert('No hay platos en la comanda para enviar.');
        return;
    }

    const orderData = {
        id: Date.now(),
        table: selectedTable,
        items: [...activeOrders[selectedTable]],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'pending' // pending, preparing, delivered
    };

    kitchenOrders.push(orderData);
    alert(`¡Pedido de ${selectedTable} enviado a cocina con éxito!`);
    
    closeOrderSection();
    renderKitchenView();
    renderCajaView();
}

// ==================== KDS COCINA (COLUMNAS VERTICALES) ====================
function renderKitchenView() {
    const pendingList = document.getElementById('kdsPending');
    const preparingList = document.getElementById('kdsPreparing');
    const deliveredList = document.getElementById('kdsDelivered');

    if (!pendingList || !preparingList || !deliveredList) return;

    pendingList.innerHTML = '';
    preparingList.innerHTML = '';
    deliveredList.innerHTML = '';

    kitchenOrders.forEach(ord => {
        let itemsHtml = ord.items.map(i => `<li>${i.name}</li>`).join('');
        const cardHtml = `
            <div class="kds-ticket">
                <h5>🍽️ ${ord.table}</h5>
                <p>Hora: ${ord.time}</p>
                <ul>${itemsHtml}</ul>
                <div style="margin-top: 0.8rem; display:flex; gap:0.5rem;">
                    ${ord.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus(${ord.id}, 'preparing')">Preparar ➔</button>` : ''}
                    ${ord.status === 'preparing' ? `<button class="btn btn-success btn-sm" onclick="updateOrderStatus(${ord.id}, 'delivered')">Entregar ✓</button>` : ''}
                </div>
            </div>
        `;

        if (ord.status === 'pending') pendingList.innerHTML += cardHtml;
        if (ord.status === 'preparing') preparingList.innerHTML += cardHtml;
        if (ord.status === 'delivered') deliveredList.innerHTML += cardHtml;
    });
}

function updateOrderStatus(id, newStatus) {
    const order = kitchenOrders.find(o => o.id === id);
    if (order) {
        order.status = newStatus;
        renderKitchenView();
    }
}

// ==================== VISTA CAJA ====================
function renderCajaView() {
    const grid = document.getElementById('cajaCardsGrid');
    if (!grid) return;

    let totalCuentas = Object.keys(activeOrders).filter(k => activeOrders[k].length > 0).length;
    let totalCobrar = 0;
    let salonCount = 0;
    let llevarCount = 0;

    grid.innerHTML = '';
    
    Object.keys(activeOrders).forEach(tableName => {
        const items = activeOrders[tableName];
        if (items.length > 0) {
            let subtotal = items.reduce((acc, i) => acc + i.price, 0);
            totalCobrar += subtotal;

            if (tableName.includes('Delivery')) llevarCount++;
            else salonCount++;

            grid.innerHTML += `
                <div class="caja-ticket-card">
                    <div class="ticket-header">
                        <span>🍽️ ${tableName}</span>
                    </div>
                    <div class="ticket-time">Ítems: ${items.length}</div>
                    <div class="ticket-price">S/ ${subtotal.toFixed(2)}</div>
                </div>
            `;
        }
    });

    document.getElementById('cajaTotalCuentas').innerText = totalCuentas;
    document.getElementById('cajaSalonLlevar').innerText = `${salonCount} / ${llevarCount}`;
    document.getElementById('cajaPorCobrar').innerText = `S/ ${totalCobrar.toFixed(2)}`;
}

// ==================== CARTA Y CONFIGURACIÓN ====================
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