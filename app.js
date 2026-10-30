// Configuración de Supabase
const SUPABASE_URL = 'https://vticelayfgcpbrvhjmsy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0aWNlbGF5ZmdjcGJydmhqbXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTkzNzksImV4cCI6MjEwODY5NTM3OX0.BaA9zKh1shxkUoa1zm6ReBVemOIOw1iyX97EdPOkZHs';

window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = window.supabaseClient;

let currentRole = 'mesero';
let isCartaFestiva = false;

let tables = [];
let dishes = [];
let kitchenOrders = [];
let isJoinMode = false;
let tablesToJoin = [];

let selectedTable = null;
let dishPendingMod = null;
let selectedComandaCaja = null; // Comanda activa abierta en el modal de caja

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

        await sincronizarComandasDesdeDB();

        renderTables();
        renderDishes('Todas');
        renderAdminMenuCategories();
        renderAdminMesas();
    } catch (err) {
        console.error("Error cargando datos de Supabase:", err);
    }
}

async function sincronizarComandasDesdeDB() {
    const { data: coms, error } = await db.from('comandas').select('*, items_comanda(*)');
    if (!error && coms) {
        kitchenOrders = coms.map(c => ({
            id: c.id,
            table: c.mesa,
            status: c.estado,
            total: parseFloat(c.total),
            time: new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            items: c.items_comanda.map(i => ({ id: i.id, name: i.nombre_plato, price: parseFloat(i.precio) }))
        }));

        // Resetear estado de mesas
        tables.forEach(t => t.status = 'free');
        coms.forEach(c => {
            if (c.estado !== 'cobrado') {
                const t = tables.find(tb => tb.name === c.mesa);
                if (t) t.status = 'occupied';
            }
        });
    }
    renderCajaView();
    renderKitchenView();
    renderTables();
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
        const { data, error } = await db.from('usuarios').select('*').ilike('usuario', usuarioInput);
        if (error) { alert('Error: ' + error.message); return; }
        if (!data || data.length === 0) { alert('El usuario no existe.'); return; }

        const perfil = data[0];
        if (String(perfil.password).trim() !== String(passwordInput).trim()) { alert('Contraseña incorrecta.'); return; }
        if (!perfil.activo) { alert('Tu cuenta está desactivada.'); return; }

        localStorage.setItem('cf_user', JSON.stringify(perfil));
        activarSesion(perfil);
    } catch (err) {
        alert('Error inesperado: ' + err.message);
    }
}

function activarSesion(perfil) {
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('appView').classList.remove('hidden');
    document.getElementById('loggedUserName').innerText = `${perfil.nombre_completo} (${perfil.rol.toUpperCase()})`;
    switchRoleView(perfil.rol);
}

function handleLogout() {
    localStorage.removeItem('cf_user');
    location.reload();
}

function switchRoleView(role) {
    currentRole = role;
    document.querySelectorAll('.role-view').forEach(el => el.classList.remove('active'));
    let target = document.getElementById(`view-${role}`);
    if (target) {
        target.classList.add('active');
        if (role === 'caja') renderCajaView();
        if (role === 'cocina') renderKitchenView();
    } else {
        document.getElementById('view-mesero').classList.add('active');
    }
}

function switchAdminTab(tabName, event) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
    if (event) event.currentTarget.classList.add('active');
    document.getElementById(`adminTab-${tabName}`).classList.add('active');
}

// ==================== MAPA DE MESAS ====================
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
    if (tablesToJoin.includes(id)) tablesToJoin = tablesToJoin.filter(t => t.id !== id);
    else tablesToJoin.push(id);

    if (tablesToJoin.length >= 2) {
        const names = tables.filter(t => tablesToJoin.includes(t.id)).map(t => t.name).join(' + ');
        alert(`Mesas unidas: ${names}`);
        isJoinMode = false;
        tablesToJoin = [];
        document.getElementById('btnJoinMode').style.background = '';
    }
    renderTables();
}

function openTakeoutView() {
    const deliveryName = "Delivery / Llevar #" + (Math.floor(Math.random() * 900) + 100);
    handleTableClick(deliveryName);
}

// ==================== TOMA DE PEDIDOS ====================
function handleTableClick(tableName) {
    selectedTable = tableName;
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

// ==================== MODIFICADORES ====================
function openModModal(dish) {
    dishPendingMod = dish;
    document.getElementById('modalDishName').innerText = dish.name;
    document.getElementById('modalDishCategory').innerText = `Categoría: ${dish.category} - Base: S/ ${dish.price.toFixed(2)}`;
    document.getElementById('modalComment').value = '';

    const container = document.getElementById('modifiersContainer');
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
        optionsHtml = `<p class="text-muted">Sin modificadores adicionales.</p>`;
    }
    container.innerHTML = optionsHtml;
    document.getElementById('modModal').classList.remove('hidden');
}

function closeModModal() {
    document.getElementById('modModal').classList.add('hidden');
    dishPendingMod = null;
}

let tempOrderCart = []; // Carrito local mientras se arma el pedido
function confirmAddToCart() {
    if (!dishPendingMod) return;
    let extraPrice = 0;
    let selectedOptionName = 'Original';

    const selectedRadio = document.querySelector('input[name="modOption"]:checked');
    if (selectedRadio) {
        selectedOptionName = selectedRadio.value;
        if (selectedOptionName === 'Arroz blanco') extraPrice = 3.00;
        if (selectedOptionName === 'Arroz Chaufa') extraPrice = dishPendingMod.category === 'Parrillas' ? 5.00 : 3.00;
    }

    const comment = document.getElementById('modalComment').value.trim();
    let finalItemName = dishPendingMod.name;
    if (selectedOptionName !== 'Original') finalItemName += ` (${selectedOptionName})`;
    if (comment) finalItemName += ` [Nota: ${comment}]`;

    tempOrderCart.push({ name: finalItemName, price: dishPendingMod.price + extraPrice });
    updateCartUI();
    closeModModal();
}

function updateCartUI() {
    const itemsContainer = document.getElementById('cartItems');
    if (!itemsContainer) return;

    if (tempOrderCart.length === 0) {
        itemsContainer.innerHTML = `<p class="empty-msg">Sin ítems aún.</p>`;
    } else {
        itemsContainer.innerHTML = '';
        tempOrderCart.forEach((item, index) => {
            itemsContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span>${item.name} - S/ ${item.price.toFixed(2)}</span>
                    <button class="btn btn-secondary btn-sm" onclick="tempOrderCart.splice(${index},1); updateCartUI();" style="padding:0.1rem 0.4rem; font-size:0.7rem;">✕</button>
                </div>
            `;
        });
    }
    let subtotal = tempOrderCart.reduce((acc, item) => acc + item.price, 0);
    document.getElementById('cartTotal').innerText = `S/ ${subtotal.toFixed(2)}`;
}

async function enviarPedidoACocina() {
    if (!selectedTable || tempOrderCart.length === 0) {
        alert('No hay platos para enviar.');
        return;
    }

    const totalMonto = tempOrderCart.reduce((acc, i) => acc + i.price, 0);

    const { data: comRes, error: errC } = await db.from('comandas').insert([{ mesa: selectedTable, estado: 'pendiente', total: totalMonto }]).select();
    if (errC) { alert('Error: ' + errC.message); return; }

    const comandaId = comRes[0].id;
    const itemsIns = tempOrderCart.map(i => ({ comanda_id: comandaId, nombre_plato: i.name, precio: i.price }));
    
    await db.from('items_comanda').insert(itemsIns);

    alert(`¡Pedido de ${selectedTable} enviado a cocina!`);
    tempOrderCart = [];
    closeOrderSection();
    await sincronizarComandasDesdeDB();
}

// ==================== KDS COCINA ====================
function renderKitchenView() {
    const pendingList = document.getElementById('kdsPending');
    const preparingList = document.getElementById('kdsPreparing');
    const deliveredList = document.getElementById('kdsDelivered');
    if (!pendingList) return;

    pendingList.innerHTML = ''; preparingList.innerHTML = ''; deliveredList.innerHTML = '';

    kitchenOrders.filter(o => o.status !== 'cobrado').forEach(ord => {
        let itemsHtml = ord.items.map(i => `<li>${i.name}</li>`).join('');
        const cardHtml = `
            <div class="kds-ticket">
                <h5>🍽️ ${ord.table}</h5>
                <p>Hora: ${ord.time}</p>
                <ul>${itemsHtml}</ul>
                <div style="margin-top: 0.8rem; display:flex; gap:0.5rem;">
                    ${ord.status === 'pendiente' ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus(${ord.id}, 'preparando')">Preparar ➔</button>` : ''}
                    ${ord.status === 'preparando' ? `<button class="btn btn-success btn-sm" onclick="updateOrderStatus(${ord.id}, 'entregado')">Entregar ✓</button>` : ''}
                </div>
            </div>
        `;
        if (ord.status === 'pendiente') pendingList.innerHTML += cardHtml;
        if (ord.status === 'preparando') preparingList.innerHTML += cardHtml;
        if (ord.status === 'entregado') deliveredList.innerHTML += cardHtml;
    });
}

async function updateOrderStatus(id, newStatus) {
    await db.from('comandas').update({ estado: newStatus }).eq('id', id);
    await sincronizarComandasDesdeDB();
}

// ==================== VISTA CAJA & CUENTAS SEPARADAS ====================
function renderCajaView() {
    const grid = document.getElementById('cajaCardsGrid');
    if (!grid) return;

    const activeTickets = kitchenOrders.filter(o => o.status !== 'cobrado');
    let salonCount = activeTickets.filter(t => !t.table.includes('Delivery')).length;
    let llevarCount = activeTickets.filter(t => t.table.includes('Delivery')).length;
    let totalCobrar = activeTickets.reduce((acc, t) => acc + t.total, 0);

    document.getElementById('cajaTotalCuentas').innerText = activeTickets.length;
    document.getElementById('cajaSalonLlevar').innerText = `${salonCount} / ${llevarCount}`;
    document.getElementById('cajaPorCobrar').innerText = `S/ ${totalCobrar.toFixed(2)}`;

    grid.innerHTML = '';
    activeTickets.forEach(ticket => {
        grid.innerHTML += `
            <div class="caja-ticket-card" onclick="openCajaModal(${ticket.id})">
                <div class="ticket-header"><span>🍽️ ${ticket.table}</span></div>
                <div class="ticket-time">Abierta ${ticket.time} | Ítems: ${ticket.items.length}</div>
                <div class="ticket-price">S/ ${ticket.total.toFixed(2)}</div>
            </div>
        `;
    });
}

function openCajaModal(comandaId) {
    selectedComandaCaja = kitchenOrders.find(o => o.id === comandaId);
    if (!selectedComandaCaja) return;

    document.getElementById('cajaModalTitle').innerText = `Detalle de Consumo - ${selectedComandaCaja.table}`;
    const listContainer = document.getElementById('cajaItemsList');
    listContainer.innerHTML = '';

    selectedComandaCaja.items.forEach((item, idx) => {
        listContainer.innerHTML += `
            <div class="caja-item-row">
                <label style="display:flex; align-items:center; gap:0.8rem; cursor:pointer;">
                    <input type="checkbox" class="caja-item-chk" value="${item.id}" data-price="${item.price}" checked onchange="calcularTotalCajaModal()">
                    <span>${item.name}</span>
                </label>
                <strong>S/ ${item.price.toFixed(2)}</strong>
            </div>
        `;
    });

    calcularTotalCajaModal();
    document.getElementById('cajaModal').classList.remove('hidden');
}

function closeCajaModal() {
    document.getElementById('cajaModal').classList.add('hidden');
    selectedComandaCaja = null;
}

function calcularTotalCajaModal() {
    const checkboxes = document.querySelectorAll('.caja-item-chk:checked');
    let sub = 0;
    checkboxes.forEach(chk => sub += parseFloat(chk.dataset.price));
    document.getElementById('cajaModalTotal').innerText = `S/ ${sub.toFixed(2)}`;
}

// Cobrar solo lo seleccionado (Cuentas Separadas / Parciales)
async function cobrarSeleccionados() {
    const checkboxes = document.querySelectorAll('.caja-item-chk:checked');
    if (checkboxes.length === 0) { alert('Selecciona al menos un ítem para cobrar.'); return; }

    const itemIdsToPay = Array.from(checkboxes).map(chk => parseInt(chk.value));
    
    // Eliminar ítems pagados de la base de datos
    for (let id of itemIdsToPay) {
        await db.from('items_comanda').delete().eq('id', id);
    }

    // Recalcular total restante de la comanda
    const remainingItems = selectedComandaCaja.items.filter(i => !itemIdsToPay.includes(i.id));
    
    if (remainingItems.length === 0) {
        // Si pagó todo, cerramos la comanda por completo
        await db.from('comandas').update({ estado: 'cobrado', total: 0 }).eq('id', selectedComandaCaja.id);
        alert('¡Cuenta cobrada y mesa liberada con éxito!');
    } else {
        // Si quedan ítems (cuenta separada parcial), actualizamos el total en Supabase
        let newTotal = remainingItems.reduce((acc, i) => acc + i.price, 0);
        await db.from('comandas').update({ total: newTotal }).eq('id', selectedComandaCaja.id);
        alert('¡Pago parcial procesado con éxito! Cuenta separada registrada.');
    }

    closeCajaModal();
    await sincronizarComandasDesdeDB();
}

// Cobrar todo el ticket de golpe
async function cobrarTodoYDesocupar() {
    if (!selectedComandaCaja) return;

    await db.from('comandas').update({ estado: 'cobrado', total: 0 }).eq('id', selectedComandaCaja.id);
    await db.from('items_comanda').delete().eq('comanda_id', selectedComandaCaja.id);

    alert(`¡Mesa ${selectedComandaCaja.table} cobrada y liberada por completo!`);
    closeCajaModal();
    await sincronizarComandasDesdeDB();
}

// ==================== CARTA Y CONFIGURACIÓN ====================
function toggleCartaFestiva(isFestiva) {
    isCartaFestiva = isFestiva;
    document.getElementById('lblCartaNormal').classList.toggle('active', !isFestiva);
    document.getElementById('lblCartaFestiva').classList.toggle('active', isFestiva);
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
        document.getElementById('kpiGastosTotal').innerText = `S/ ${totalGastos.toFixed(2)}`;
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
    if (error) { alert('Error: ' + error.message); } else {
        alert('Plato agregado');
        document.getElementById('formPlato').reset();
        cargarDatosDesdeSupabase();
    }
}

function renderAdminMenuCategories() {
    const container = document.getElementById('adminMenuCategoriesContainer');
    if (!container) return;
    container.innerHTML = '';

    ['Parrillas', 'Cenas', 'Selvaticos', 'Guarniciones', 'Bebidas'].forEach(cat => {
        const platosCat = dishes.filter(d => d.category === cat);
        let itemsHtml = platosCat.length === 0 ? `<p class="text-muted">No hay productos.</p>` : '';
        platosCat.forEach(d => {
            itemsHtml += `
                <div class="menu-item-row">
                    <span>${d.name}</span>
                    <div style="text-align: right;"><span class="menu-item-prices">S/ ${d.price.toFixed(2)}</span><div class="menu-item-fest">Fest. S/ ${d.festivo.toFixed(2)}</div></div>
                </div>
            `;
        });
        container.innerHTML += `
            <div class="admin-category-section">
                <div class="admin-category-title"><span>${cat}</span><span class="text-muted">${platosCat.length} ítems</span></div>
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
        await db.from('mesas').insert([{ nombre: `Mesa ${num}`, status: 'free' }]);
        document.getElementById('nuevaMesaNum').value = '';
        cargarDatosDesdeSupabase();
    }
}

async function eliminarMesa(id) {
    await db.from('mesas').delete().eq('id', id);
    cargarDatosDesdeSupabase();
}

async function crearUsuarioTrabajador(e) {
    e.preventDefault();
    const usuario = document.getElementById('usrUser').value;
    const nombre_completo = document.getElementById('usrNombre').value;
    const password = document.getElementById('usrPass').value;
    const rol = document.getElementById('usrRol').value;

    const { error } = await db.from('usuarios').insert([{ usuario, nombre_completo, password, rol, activo: true }]);
    if (error) { alert('Error: ' + error.message); } else {
        alert('Trabajador creado con éxito.');
        e.target.reset();
    }
}