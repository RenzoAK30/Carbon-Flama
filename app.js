// Configuración de Supabase
const SUPABASE_URL = 'https://vticelayfgcpbrvhjmsy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0aWNlbGF5ZmdjcGJydmhqbXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTkzNzksImV4cCI6MjEwODY5NTM3OX0.BaA9zKh1shxkUoa1zm6ReBVemOIOw1iyX97EdPOkZHs';

window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = window.supabaseClient;

let currentUserProfile = null;
let currentRole = 'mesero';
let isCartaFestiva = false;
let isFestiva = false;

let tables = [];
let dishes = [];
let kitchenOrders = [];
let activeClientNames = {}; 
let systemUsers = [];

let isJoinMode = false;
let tablesToJoin = [];

let selectedTable = null;
let dishPendingMod = null;
let selectedComandaCaja = null;

document.addEventListener('DOMContentLoaded', () => {
    const loggedUser = localStorage.getItem('cf_user');
    if (loggedUser) {
        try {
            currentUserProfile = JSON.parse(loggedUser);
            activarSesion(currentUserProfile);
        } catch (e) {
            localStorage.removeItem('cf_user');
        }
    }

    cargarDatosDesdeSupabase();
    configurarSupabaseRealtime();
});

// ==================== REALTIME ====================
function configurarSupabaseRealtime() {
    db.channel('public-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
          console.log('Cambio detectado en tiempo real:', payload);
          if (payload.table === 'configuracion') {
              isCartaFestiva = payload.new.carta_festiva;
              isFestiva = isCartaFestiva;
              const chk = document.getElementById('chkFestiva');
              if (chk) chk.checked = isCartaFestiva;
              actualizarInterfazCartaVisual();
              renderDishes('Todas');
          } else if (payload.table === 'usuarios') {
              cargarUsuariosAdmin();
          } else {
              sincronizarComandasDesdeDB();
          }
      })
      .subscribe();
}

async function cargarDatosDesdeSupabase() {
    try {
        const { data: configData, error: errConfig } = await db.from('configuracion').select('*').eq('id', 1).single();
        if (!errConfig && configData) {
            isCartaFestiva = configData.carta_festiva;
            isFestiva = isCartaFestiva;
            const chk = document.getElementById('chkFestiva');
            if (chk) chk.checked = isCartaFestiva;
            actualizarInterfazCartaVisual();
        }

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
                festivo: p.festivo !== null && p.festivo !== undefined ? parseFloat(p.festivo) : parseFloat(p.precio),
                costo: parseFloat(p.costo || 0),
                stock: parseInt(p.stock || 0)
            }));
        }

        await sincronizarComandasDesdeDB();
        renderTables();
        renderDishes('Todas');
        renderAdminMenuCategories();
        renderAdminMesas();
        renderAlmacenView();
        cargarClientesAdmin();
        cargarUsuariosAdmin();
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
            cliente_nombre: c.cliente_nombre || 'Sin nombre',
            cliente_dni: c.cliente_dni,
            time: new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            created_at: c.created_at,
            items: c.items_comanda.map(i => ({ id: i.id, name: i.nombre_plato, price: parseFloat(i.precio) }))
        }));

        coms.forEach(c => {
            if (c.estado !== 'cobrado' && c.cliente_nombre) {
                activeClientNames[c.mesa] = c.cliente_nombre;
            }
        });

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
    renderAlmacenView();
    renderAdminMesas();
    loadFinanzasData();
    cargarClientesAdmin();
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

        currentUserProfile = perfil;
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
    currentUserProfile = null;
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
        if (role === 'almacen') renderAlmacenView();
        if (role === 'admin') {
            loadFinanzasData();
            cargarClientesAdmin();
            cargarUsuariosAdmin();
            renderAdminMesas();
        }
    } else {
        document.getElementById('view-mesero').classList.add('active');
    }
}

function switchAdminTab(tabName, event) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
    if (event) event.currentTarget.classList.add('active');
    document.getElementById(`adminTab-${tabName}`).classList.add('active');
    if (tabName === 'clientes') cargarClientesAdmin();
    if (tabName === 'usuarios') cargarUsuariosAdmin();
    if (tabName === 'mesas') renderAdminMesas();
}

// ==================== REPORTE DETALLADO DE VENTAS ====================
async function filtrarReportesPorFecha() {
    const fechaInicio = document.getElementById('reporteFechaInicio').value;
    const fechaFin = document.getElementById('reporteFechaFin').value;
    const resultadoDiv = document.getElementById('reporteFiltradoResultado');

    if (!fechaInicio || !fechaFin) {
        alert('Por favor selecciona una fecha de inicio y fin.');
        return;
    }

    try {
        let inicioIso = new Date(fechaInicio + 'T00:00:00').toISOString();
        let finIso = new Date(fechaFin + 'T23:59:59').toISOString();

        const { data, error } = await db.from('comandas').select('*, items_comanda(*)').eq('estado', 'cobrado').gte('created_at', inicioIso).lte('created_at', finIso);
        if (error) { resultadoDiv.innerHTML = `<p style="color:var(--accent-red);">Error al filtrar: ${error.message}</p>`; return; }

        let totalRango = data.reduce((acc, c) => acc + parseFloat(c.total), 0);

        let detalleHtml = `
            <div style="background:#1e1e24; padding:1rem; border-radius:8px; margin-top:0.8rem; border:1px solid var(--border-color);">
                <p><b>Período:</b> ${fechaInicio} al ${fechaFin}</p>
                <p><b>Total Comandas Cobradas:</b> ${data.length}</p>
                <h4 style="color:var(--accent-green); margin:0.5rem 0 1rem 0;">Total Vendido: S/ ${totalRango.toFixed(2)}</h4>
                
                <h5>Desglose Detallado de Comandas:</h5>
                <div style="max-height: 300px; overflow-y:auto; margin-top:0.5rem; display:flex; flex-direction:column; gap:0.5rem;">
        `;

        if (data.length === 0) {
            detalleHtml += `<p class="text-muted">No hay comandas cobradas en este rango.</p>`;
        } else {
            data.forEach(c => {
                let itemsList = c.items_comanda ? c.items_comanda.map(i => `${i.nombre_plato} (S/ ${parseFloat(i.precio).toFixed(2)})`).join(', ') : 'Sin ítems';
                detalleHtml += `
                    <div style="background:#2b2d42; padding:0.6rem; border-radius:6px; font-size:0.85rem; border:1px solid var(--border-color);">
                        <b>Mesa/Llevar:</b> ${c.mesa} | <b>Cliente:</b> ${c.cliente_nombre || 'Sin nombre'} | <b>Hora:</b> ${new Date(c.created_at).toLocaleTimeString()}<br>
                        <b>Ítems:</b> ${itemsList}<br>
                        <span style="color:var(--primary-color); font-weight:600;">Total Comanda: S/ ${parseFloat(c.total).toFixed(2)}</span>
                    </div>
                `;
            });
        }

        detalleHtml += `</div></div>`;
        resultadoDiv.innerHTML = detalleHtml;
    } catch (e) {
        console.error("Error en reporte detallado:", e);
    }
}

// ==================== REPORTE DE BEBIDAS Y UTILIDAD ====================
async function generarReporteGaseosas() {
    const fechaInicio = document.getElementById('reporteGaseosaInicio').value;
    const fechaFin = document.getElementById('reporteGaseosaFin').value;
    const contenedor = document.getElementById('resultadoReporteGaseosas');

    if (!fechaInicio || !fechaFin) {
        alert('Por favor selecciona una fecha de inicio y una fecha de fin.');
        return;
    }

    try {
        contenedor.innerHTML = `<p class="text-muted">Calculando reporte de bebidas...</p>`;

        let inicioIso = new Date(fechaInicio + 'T00:00:00').toISOString();
        let finIso = new Date(fechaFin + 'T23:59:59').toISOString();

        const { data: comandas, error } = await db
            .from('comandas')
            .select('*, items_comanda(*)')
            .eq('estado', 'cobrado')
            .gte('created_at', inicioIso)
            .lte('created_at', finIso);

        if (error) {
            contenedor.innerHTML = `<p style="color:var(--accent-red);">Error al obtener datos: ${error.message}</p>`;
            return;
        }

        if (!comandas || comandas.length === 0) {
            contenedor.innerHTML = `<p class="text-muted">No se registraron ventas en el rango de fechas seleccionado.</p>`;
            return;
        }

        const bebidasCatalogo = dishes.filter(d => d.category && d.category.trim().toLowerCase() === 'bebidas');
        
        if (bebidasCatalogo.length === 0) {
            contenedor.innerHTML = `<p style="color:var(--accent-yellow);">No hay bebidas registradas en el catálogo con la categoría "Bebidas".</p>`;
            return;
        }

        let resumenBebidas = {};
        bebidasCatalogo.forEach(b => {
            resumenBebidas[b.name] = {
                cantidadVendida: 0,
                costoUnitario: b.costo || 0,
                ingresoTotal: 0,
                costoTotal: 0,
                utilidadTotal: 0
            };
        });

        comandas.forEach(c => {
            if (c.items_comanda) {
                c.items_comanda.forEach(item => {
                    let nombreItemLimpio = item.nombre_plato.toLowerCase();
                    bebidasCatalogo.forEach(b => {
                        if (nombreItemLimpio.includes(b.name.toLowerCase())) {
                            resumenBebidas[b.name].cantidadVendida += 1;
                            resumenBebidas[b.name].ingresoTotal += parseFloat(item.precio || 0);
                            resumenBebidas[b.name].costoTotal += parseFloat(b.costo || 0);
                            resumenBebidas[b.name].utilidadTotal += (parseFloat(item.precio || 0) - parseFloat(b.costo || 0));
                        }
                    });
                });
            }
        });

        let htmlTabla = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Tipo de Bebida</th>
                        <th>Cant. Vendida</th>
                        <th>P. Venta Prom.</th>
                        <th>Costo Compra Unit.</th>
                        <th>Ingreso Total</th>
                        <th>Costo Total</th>
                        <th>Utilidad (Ganancia)</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let totalUnidadesGeneral = 0;
        let totalIngresosGeneral = 0;
        let totalCostoGeneral = 0;
        let totalUtilidadGeneral = 0;
        let hayVentasBebidas = false;

        Object.keys(resumenBebidas).forEach(nombre => {
            let dataBebida = resumenBebidas[nombre];
            if (dataBebida.cantidadVendida > 0) {
                hayVentasBebidas = true;
                totalUnidadesGeneral += dataBebida.cantidadVendida;
                totalIngresosGeneral += dataBebida.ingresoTotal;
                totalCostoGeneral += dataBebida.costoTotal;
                totalUtilidadGeneral += dataBebida.utilidadTotal;

                let pVentaProm = dataBebida.ingresoTotal / dataBebida.cantidadVendida;

                htmlTabla += `
                    <tr>
                        <td><b>${nombre}</b></td>
                        <td><span style="color:var(--accent-yellow);">${dataBebida.cantidadVendida} unids.</span></td>
                        <td>S/ ${pVentaProm.toFixed(2)}</td>
                        <td>S/ ${dataBebida.costoUnitario.toFixed(2)}</td>
                        <td>S/ ${dataBebida.ingresoTotal.toFixed(2)}</td>
                        <td>S/ ${dataBebida.costoTotal.toFixed(2)}</td>
                        <td><strong style="color:var(--accent-green);">S/ ${dataBebida.utilidadTotal.toFixed(2)}</strong></td>
                    </tr>
                `;
            }
        });

        if (!hayVentasBebidas) {
            contenedor.innerHTML = `<p class="text-muted">No se registraron ventas de bebidas en este período.</p>`;
            return;
        }

        htmlTabla += `
                </tbody>
            </table>
            <div style="background:#1e1e24; padding:1rem; border-radius:8px; margin-top:1rem; border:1px solid var(--border-color); display:flex; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
                <div><b>Total Bebidas Vendidas:</b> ${totalUnidadesGeneral} unids.</div>
                <div><b>Ingreso Bruto:</b> S/ ${totalIngresosGeneral.toFixed(2)}</div>
                <div><b>Costo Total:</b> S/ ${totalCostoGeneral.toFixed(2)}</div>
                <div><h4 style="color:var(--accent-green);">Utilidad Total Bebidas: S/ ${totalUtilidadGeneral.toFixed(2)}</h4></div>
            </div>
        `;

        contenedor.innerHTML = htmlTabla;

    } catch (e) {
        console.error("Error al generar reporte de bebidas:", e);
        contenedor.innerHTML = `<p style="color:var(--accent-red);">Ocurrió un error al procesar el reporte.</p>`;
    }
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
let tempOrderCart = [];

function handleTableClick(tableName) {
    selectedTable = tableName;
    tempOrderCart = [];

    document.getElementById('salonMapSection').classList.add('hidden');
    document.getElementById('orderSection').classList.remove('hidden');
    document.getElementById('currentOrderTitle').innerText = selectedTable;
    document.getElementById('cartTableTitle').innerText = selectedTable;

    const taperSec = document.getElementById('taperSection');
    const tapersInput = document.getElementById('tapersInput');
    if (tableName.includes('Delivery') || tableName.includes('Llevar')) {
        if (taperSec) taperSec.classList.remove('hidden');
        if (tapersInput) tapersInput.value = "0";
    } else {
        if (taperSec) taperSec.classList.add('hidden');
        if (tapersInput) tapersInput.value = "0";
    }

    const clientSpan = document.getElementById('assignedClientTag');
    const currentName = activeClientNames[selectedTable] || 'Sin nombre';
    clientSpan.innerText = `Cliente: ${currentName}`;

    updateCartUI();
}

function closeOrderSection() {
    document.getElementById('orderSection').classList.add('hidden');
    document.getElementById('salonMapSection').classList.remove('hidden');
    selectedTable = null;
    renderTables();
}

// ==================== MOVER PEDIDO DE MESA ====================
function openMoveTableModal() {
    if (!selectedTable) return;
    const existingOrder = kitchenOrders.find(o => o.table === selectedTable && o.status !== 'cobrado');
    if (!existingOrder) {
        alert('Esta mesa no tiene comandas activas pendientes por mover.');
        return;
    }

    const select = document.getElementById('targetTableSelect');
    select.innerHTML = '';

    const availableTables = tables.filter(t => t.status === 'free' && t.name !== selectedTable);
    if (availableTables.length === 0) {
        select.innerHTML = `<option value="">No hay mesas libres disponibles</option>`;
    } else {
        availableTables.forEach(t => {
            select.innerHTML += `<option value="${t.name}">${t.name}</option>`;
        });
    }

    document.getElementById('moveTableModal').classList.remove('hidden');
}

function closeMoveTableModal() {
    document.getElementById('moveTableModal').classList.add('hidden');
}

async function confirmMoveTable() {
    const targetTable = document.getElementById('targetTableSelect').value;
    if (!targetTable) {
        alert('Selecciona una mesa destino válida.');
        return;
    }

    const existingOrder = kitchenOrders.find(o => o.table === selectedTable && o.status !== 'cobrado');
    if (!existingOrder) return;

    try {
        const { error } = await db.from('comandas').update({ mesa: targetTable }).eq('id', existingOrder.id);
        if (error) {
            alert('Error al mover comanda: ' + error.message);
            return;
        }

        if (activeClientNames[selectedTable]) {
            activeClientNames[targetTable] = activeClientNames[selectedTable];
            delete activeClientNames[selectedTable];
        }

        alert(`¡Pedido trasladado exitosamente de ${selectedTable} a ${targetTable}!`);
        closeMoveTableModal();
        closeOrderSection();
        await sincronizarComandasDesdeDB();
    } catch (e) {
        console.error("Error al mover mesa:", e);
    }
}

// ==================== NOMBRE RÁPIDO CLIENTE ====================
function openQuickClientModal() {
    document.getElementById('quickClientNameInput').value = activeClientNames[selectedTable] || '';
    document.getElementById('clientQuickModal').classList.remove('hidden');
}

function closeQuickClientModal() {
    document.getElementById('clientQuickModal').classList.add('hidden');
}

async function confirmQuickClientName() {
    const name = document.getElementById('quickClientNameInput').value.trim();
    if (!name) {
        alert('Por favor ingresa un nombre.');
        return;
    }

    activeClientNames[selectedTable] = name;
    document.getElementById('assignedClientTag').innerText = `Cliente: ${name}`;

    let existingComanda = kitchenOrders.find(o => o.table === selectedTable && o.status !== 'cobrado');
    if (existingComanda) {
        await db.from('comandas').update({ cliente_nombre: name }).eq('id', existingComanda.id);
    }

    closeQuickClientModal();
}

function filterCategory(cat) { renderDishes(cat); }

function renderDishes(cat) {
    const grid = document.getElementById('dishesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const filtered = cat === 'Todas' ? dishes : dishes.filter(d => d.category === cat);
    
    filtered.forEach(dish => {
        const currentPrice = isCartaFestiva ? dish.festivo : dish.price;
        const div = document.createElement('div');
        div.className = 'dish-card';
        div.innerHTML = `
            <h5>${dish.name}</h5>
            <p>S/ ${currentPrice.toFixed(2)}</p>
            <small class="text-muted">Stock: ${dish.stock}</small>
            <div>${isCartaFestiva ? '<span style="font-size:0.7rem; color:var(--accent-yellow);">Festivo</span>' : '<span style="font-size:0.7rem; color:var(--text-muted);">Normal</span>'}</div>
        `;
        div.onclick = () => openModModal({ ...dish, price: currentPrice });
        grid.appendChild(div);
    });
}

// ==================== MODIFICADORES ====================
function openModModal(dish) {
    dishPendingMod = dish;
    document.getElementById('modalDishName').innerText = dish.name;
    document.getElementById('modalDishCategory').innerText = `Categoría: ${dish.category} - Precio: S/ ${dish.price.toFixed(2)}`;
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

    tempOrderCart.push({ id: dishPendingMod.id, name: finalItemName, price: dishPendingMod.price + extraPrice });
    updateCartUI();
    closeModModal();
}

function updateCartUI() {
    const itemsContainer = document.getElementById('cartItems');
    if (!itemsContainer) return;

    const existingOrder = kitchenOrders.find(o => o.table === selectedTable && o.status !== 'cobrado');
    let allItemsToDisplay = existingOrder ? [...existingOrder.items, ...tempOrderCart] : [...tempOrderCart];

    let tapersCount = 0;
    const tapersInput = document.getElementById('tapersInput');
    if (selectedTable && (selectedTable.includes('Delivery') || selectedTable.includes('Llevar'))) {
        tapersCount = parseInt(tapersInput ? tapersInput.value : 0) || 0;
    }

    if (allItemsToDisplay.length === 0 && tapersCount === 0) {
        itemsContainer.innerHTML = `<p class="empty-msg">Sin ítems aún.</p>`;
    } else {
        itemsContainer.innerHTML = '';
        allItemsToDisplay.forEach((item, index) => {
            let isNew = index >= (existingOrder ? existingOrder.items.length : 0);

            itemsContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span>${item.name} - S/ ${item.price.toFixed(2)} ${isNew ? '<span style="color:var(--accent-green); font-size:0.7rem;">(Nuevo)</span>' : ''}</span>
                    <div style="display:flex; gap:0.3rem; align-items:center;">
                        ${isNew ? `<button class="btn btn-secondary btn-sm" onclick="tempOrderCart.splice(${index - (existingOrder ? existingOrder.items.length : 0)},1); updateCartUI();" style="padding:0.1rem 0.4rem; font-size:0.7rem;">✕</button>` : ''}
                        ${!isNew ? `<button class="btn btn-danger btn-sm" onclick="eliminarItemComandaSeguro(${existingOrder.id}, ${item.id})" title="Eliminar plato" style="padding:0.1rem 0.4rem; font-size:0.7rem; background:var(--accent-red); color:#fff;">🗑️</button>` : ''}
                    </div>
                </div>
            `;
        });

        if (tapersCount > 0) {
            itemsContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); color:var(--accent-yellow);">
                    <span>📦 ${tapersCount} Táper(s) S/ 1.00 c/u</span>
                    <span>S/ ${(tapersCount * 1.00).toFixed(2)}</span>
                </div>
            `;
        }
    }

    let subtotalItems = allItemsToDisplay.reduce((acc, item) => acc + item.price, 0);
    let totalSub = subtotalItems + (tapersCount * 1.00);
    document.getElementById('cartTotal').innerText = `S/ ${totalSub.toFixed(2)}`;
}

// ==================== ELIMINAR ÍTEM ====================
async function eliminarItemComandaSeguro(comandaId, itemId) {
    if (!currentUserProfile || (currentUserProfile.rol !== 'admin' && currentUserProfile.rol !== 'mesero')) {
        alert('⚠️ No tienes permisos para eliminar ítems.');
        return;
    }

    if (!confirm('¿Estás seguro de eliminar este plato de la comanda?')) return;

    try {
        const { error } = await db.from('items_comanda').delete().eq('id', itemId);
        if (error) {
            alert('Error al eliminar ítem: ' + error.message);
            return;
        }

        const comanda = kitchenOrders.find(o => o.id === comandaId);
        if (comanda) {
            const nuevosItems = comanda.items.filter(i => i.id !== itemId);
            let nuevoTotal = nuevosItems.reduce((acc, i) => acc + i.price, 0);
            await db.from('comandas').update({ total: nuevoTotal }).eq('id', comandaId);
        }

        alert('Plato eliminado correctamente.');
        await sincronizarComandasDesdeDB();
        updateCartUI();
    } catch (e) {
        console.error("Error eliminando ítem:", e);
    }
}

async function enviarPedidoACocina() {
    if (!selectedTable) return;

    let itemsAEnviar = [...tempOrderCart];
    const tapersInput = document.getElementById('tapersInput');
    let tapersCount = (selectedTable.includes('Delivery') || selectedTable.includes('Llevar')) ? (parseInt(tapersInput ? tapersInput.value : 0) || 0) : 0;

    if (itemsAEnviar.length === 0 && tapersCount === 0) {
        alert('Agrega nuevos platos o tápers antes de enviar a cocina.');
        return;
    }

    if (tapersCount > 0) {
        for (let i = 0; i < tapersCount; i++) {
            itemsAEnviar.push({ name: '📦 Táper Adicional', price: 1.00 });
        }
    }

    const clienteNombre = activeClientNames[selectedTable] || 'Sin nombre';
    let existingComanda = kitchenOrders.find(o => o.table === selectedTable && o.status !== 'cobrado');

    if (existingComanda) {
        const itemsIns = itemsAEnviar.map(i => ({ comanda_id: existingComanda.id, nombre_plato: i.name, precio: i.price }));
        await db.from('items_comanda').insert(itemsIns);

        let nuevoTotalTotal = existingComanda.total + itemsAEnviar.reduce((acc, i) => acc + i.price, 0);
        await db.from('comandas').update({ total: nuevoTotalTotal, cliente_nombre: clienteNombre }).eq('id', existingComanda.id);
    } else {
        let totalMonto = itemsAEnviar.reduce((acc, i) => acc + i.price, 0);
        const { data: comRes, error: errC } = await db.from('comandas').insert([{ 
            mesa: selectedTable, 
            estado: 'pendiente', 
            total: totalMonto,
            cliente_nombre: clienteNombre 
        }]).select();

        if (errC) { alert('Error: ' + errC.message); return; }

        const comandaId = comRes[0].id;
        const itemsIns = itemsAEnviar.map(i => ({ comanda_id: comandaId, nombre_plato: i.name, precio: i.price }));
        await db.from('items_comanda').insert(itemsIns);
    }

    alert(`¡Pedido enviado a cocina con éxito!`);
    tempOrderCart = [];
    if (tapersInput) tapersInput.value = "0";
    await sincronizarComandasDesdeDB();
    updateCartUI();
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
                <h5>🍽️ ${ord.table} - <span style="color:var(--accent-yellow);">${ord.cliente_nombre}</span></h5>
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

// ==================== CAJA & CUENTAS ====================
function renderCajaView() {
    const grid = document.getElementById('cajaCardsGrid');
    if (!grid) return;

    const activeTickets = kitchenOrders.filter(o => o.status !== 'cobrado');
    let salonCount = activeTickets.filter(t => !t.table.includes('Delivery') && !t.table.includes('Llevar')).length;
    let llevarCount = activeTickets.filter(t => t.table.includes('Delivery') || t.table.includes('Llevar')).length;
    let totalCobrar = activeTickets.reduce((acc, t) => acc + t.total, 0);

    document.getElementById('cajaTotalCuentas').innerText = activeTickets.length;
    document.getElementById('cajaSalonLlevar').innerText = `${salonCount} / ${llevarCount}`;
    document.getElementById('cajaPorCobrar').innerText = `S/ ${totalCobrar.toFixed(2)}`;

    grid.innerHTML = '';
    activeTickets.forEach(ticket => {
        grid.innerHTML += `
            <div class="caja-ticket-card" onclick="openCajaModal(${ticket.id})">
                <div class="ticket-header"><span>🍽️ ${ticket.table}</span></div>
                <div class="ticket-time"><b>Cliente:</b> ${ticket.cliente_nombre}<br>Abierta ${ticket.time} | Ítems: ${ticket.items.length}</div>
                <div class="ticket-price">S/ ${ticket.total.toFixed(2)}</div>
            </div>
        `;
    });
}

function openCajaModal(comandaId) {
    selectedComandaCaja = kitchenOrders.find(o => o.id === comandaId);
    if (!selectedComandaCaja) return;

    document.getElementById('cajaModalTitle').innerText = `Detalle de Consumo - ${selectedComandaCaja.table} (${selectedComandaCaja.cliente_nombre})`;
    
    document.getElementById('cajaClientDni').value = selectedComandaCaja.cliente_dni || '';
    document.getElementById('cajaClientName').value = selectedComandaCaja.cliente_nombre !== 'Sin nombre' ? selectedComandaCaja.cliente_nombre : '';
    document.getElementById('cajaClientPhone').value = '';

    const listContainer = document.getElementById('cajaItemsList');
    listContainer.innerHTML = '';

    selectedComandaCaja.items.forEach((item) => {
        listContainer.innerHTML += `
            <div class="caja-item-row">
                <label style="display:flex; align-items:center; gap:0.8rem; cursor:pointer;">
                    <input type="checkbox" class="caja-item-chk" value="${item.id}" data-name="${item.name}" data-price="${item.price}" checked onchange="calcularTotalCajaModal()">
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

async function buscarClienteCajaPorDni() {
    const dni = document.getElementById('cajaClientDni').value.trim();
    if (dni.length === 8) {
        try {
            const { data, error } = await db.from('clientes').select('*').eq('dni', dni).single();
            if (!error && data) {
                document.getElementById('cajaClientName').value = data.nombre || '';
                document.getElementById('cajaClientPhone').value = data.telefono || '';
            }
        } catch (e) {
            console.error("Cliente no encontrado:", e);
        }
    }
}

function imprimirPrecuenta() {
    if (!selectedComandaCaja) return;
    const checkboxes = document.querySelectorAll('.caja-item-chk:checked');
    let itemsSeleccionados = [];
    let sub = 0;

    checkboxes.forEach(chk => {
        let itemId = parseInt(chk.value);
        let found = selectedComandaCaja.items.find(i => i.id === itemId);
        if (found) {
            itemsSeleccionados.push(found);
            sub += found.price;
        }
    });

    let ventana = window.open('', '_blank', 'width=300,height=600');
    ventana.document.write(`
        <html>
        <head>
            <title>Precuenta - Carbón & Flama</title>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body { font-family: 'Courier New', Courier, monospace; width: 72mm; margin: 4mm auto; font-size: 12px; color: #000; text-align: left; }
                .text-center { text-align: center; }
                .bold { font-weight: bold; }
                hr { border: dashed 1px #000; margin: 5px 0; }
            </style>
        </head>
        <body>
            <div class="text-center bold" style="font-size: 14px;">CARBÓN & FLAMA</div>
            <div class="text-center">RUC: 20000000001</div>
            <div class="text-center">--- PRECUENTA ---</div>
            <br>
            <div><b>Mesa:</b> ${selectedComandaCaja.table}</div>
            <div><b>Cliente:</b> ${document.getElementById('cajaClientName').value || selectedComandaCaja.cliente_nombre}</div>
            <div><b>Fecha/Hora:</b> ${new Date().toLocaleString()}</div>
            <hr/>
            <div>
                ${itemsSeleccionados.map(i => `
                    <div style="margin-bottom: 4px;">
                        <div>${i.name}</div>
                        <div style="text-align: right; font-weight: bold;">S/ ${i.price.toFixed(2)}</div>
                    </div>
                `).join('')}
            </div>
            <hr/>
            <div style="font-size: 14px; text-align: right;" class="bold">TOTAL: S/ ${sub.toFixed(2)}</div>
            <hr/>
            <div class="text-center" style="font-size: 10px; margin-top: 10px;">¡Gracias por su preferencia!<br>Documento no válido como comprobante.</div>
        </body>
        </html>
    `);
    ventana.document.close();
    setTimeout(() => { ventana.print(); }, 300);
}

async function descontarStockPorItemsPagados(checkboxes) {
    for (let chk of checkboxes) {
        let nombreItem = chk.dataset.name.toLowerCase();
        let platoMatch = dishes.find(d => nombreItem.includes(d.name.toLowerCase()));
        if (platoMatch && platoMatch.stock > 0) {
            let nuevoStock = platoMatch.stock - 1;
            await db.from('platos').update({ stock: nuevoStock }).eq('id', platoMatch.id);
            platoMatch.stock = nuevoStock;
        }
    }
}

async function registrarClienteEnBaseDatosCaja() {
    const dni = document.getElementById('cajaClientDni').value.trim();
    const nombre = document.getElementById('cajaClientName').value.trim();
    const telefono = document.getElementById('cajaClientPhone').value.trim();

    if (dni && nombre) {
        await db.from('clientes').upsert([{ dni, nombre, telefono }], { onConflict: 'dni' });
        return dni;
    }
    return null;
}

async function cobrarSeleccionados() {
    const checkboxes = document.querySelectorAll('.caja-item-chk:checked');
    if (checkboxes.length === 0) { alert('Selecciona al menos un ítem.'); return; }

    const itemIdsToPay = Array.from(checkboxes).map(chk => parseInt(chk.value));
    let montoPagadoParcial = Array.from(checkboxes).reduce((acc, chk) => acc + parseFloat(chk.dataset.price), 0);

    const dniRegistrado = await registrarClienteEnBaseDatosCaja();
    await descontarStockPorItemsPagados(checkboxes);

    for (let id of itemIdsToPay) {
        await db.from('items_comanda').delete().eq('id', id);
    }

    const remainingItems = selectedComandaCaja.items.filter(i => !itemIdsToPay.includes(i.id));
    
    if (dniRegistrado) {
        await actualizarConsumoCliente(dniRegistrado, montoPagadoParcial);
        await db.from('comandas').update({ cliente_dni: dniRegistrado }).eq('id', selectedComandaCaja.id);
    }

    if (remainingItems.length === 0) {
        await db.from('comandas').update({ estado: 'cobrado' }).eq('id', selectedComandaCaja.id);
        alert('¡Cuenta cobrada y mesa liberada con éxito!');
    } else {
        let newTotal = remainingItems.reduce((acc, i) => acc + i.price, 0);
        await db.from('comandas').update({ total: newTotal }).eq('id', selectedComandaCaja.id);
        alert('¡Pago parcial procesado con éxito!');
    }

    closeCajaModal();
    await sincronizarComandasDesdeDB();
}

async function cobrarTodoYDesocupar() {
    if (!selectedComandaCaja) return;

    const checkboxes = document.querySelectorAll('.caja-item-chk');
    const dniRegistrado = await registrarClienteEnBaseDatosCaja();
    await descontarStockPorItemsPagados(checkboxes);

    let montoTotalComanda = selectedComandaCaja.total;
    if (dniRegistrado) {
        await actualizarConsumoCliente(dniRegistrado, montoTotalComanda);
    }

    await db.from('comandas').update({ estado: 'cobrado', ...(dniRegistrado ? { cliente_dni: dniRegistrado } : {}) }).eq('id', selectedComandaCaja.id);
    await db.from('items_comanda').delete().eq('comanda_id', selectedComandaCaja.id);

    alert(`¡Mesa ${selectedComandaCaja.table} cobrada y liberada por completo!`);
    closeCajaModal();
    await sincronizarComandasDesdeDB();
}

async function actualizarConsumoCliente(dni, montoAdicional) {
    try {
        const { data: cliente, error } = await db.from('clientes').select('consumo_total').eq('dni', dni).single();
        if (!error && cliente) {
            let nuevoTotal = (parseFloat(cliente.consumo_total) || 0) + parseFloat(montoAdicional);
            await db.from('clientes').update({ consumo_total: nuevoTotal }).eq('dni', dni);
        }
    } catch (e) {
        console.error("Error actualizando consumo:", e);
    }
}

// ==================== ALMACÉN & CRUD KARDEX ESTRICTO ====================
function renderAlmacenView() {
    const tbody = document.getElementById('almacenTableBody');
    if (!tbody) return;

    // Filtrar estrictamente solo Bebidas y materias primas solicitadas
    const insumosPermitidos = ['chuleta', 'marucha', 'tira', 'chorizo', 'hotdog', 'cecina'];
    const productosAlmacen = dishes.filter(d => {
        let cat = (d.category || '').toLowerCase();
        let nom = (d.name || '').toLowerCase();
        if (cat === 'bebidas') return true;
        return insumosPermitidos.some(ins => nom.includes(ins));
    });

    if (productosAlmacen.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4">No hay productos ni materias primas configuradas para almacén.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    productosAlmacen.forEach(d => {
        tbody.innerHTML += `
            <tr>
                <td><b>${d.name}</b></td>
                <td>${d.category}</td>
                <td><span style="font-size:1.05rem; color:var(--accent-yellow); font-weight:600;">${d.stock} unids.</span></td>
                <td>
                    <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                        <input type="number" id="inputStock_${d.id}" value="${d.stock}" min="0" style="width:70px; padding:0.3rem; background:#1e1e24; color:#fff; border:1px solid var(--border-color); border-radius:4px;" />
                        <button class="btn btn-primary btn-sm" onclick="crudActualizarStock(${d.id}, 'fijar')">💾 Guardar</button>
                        <input type="number" id="addStock_${d.id}" placeholder="+Cant" min="1" style="width:60px; padding:0.3rem; background:#1e1e24; color:#fff; border:1px solid var(--border-color); border-radius:4px;" />
                        <button class="btn btn-success btn-sm" onclick="crudActualizarStock(${d.id}, 'sumar')">+ Sumar</button>
                    </div>
                </td>
            </tr>
        `;
    });
}

async function crudActualizarStock(platoId, modo) {
    let nuevoStockTotal = 0;
    const plato = dishes.find(d => d.id === platoId);
    if (!plato) return;

    if (modo === 'fijar') {
        const inputVal = document.getElementById(`inputStock_${platoId}`).value;
        nuevoStockTotal = parseInt(inputVal);
        if (isNaN(nuevoStockTotal) || nuevoStockTotal < 0) {
            alert('Ingresa un valor de stock válido.');
            return;
        }
    } else if (modo === 'sumar') {
        const cantSumar = parseInt(document.getElementById(`addStock_${platoId}`).value);
        if (!cantSumar || cantSumar <= 0) {
            alert('Ingresa una cantidad válida para sumar.');
            return;
        }
        nuevoStockTotal = plato.stock + cantSumar;
    }

    const { error } = await db.from('platos').update({ stock: nuevoStockTotal }).eq('id', platoId);
    if (error) {
        alert('Error al actualizar inventario: ' + error.message);
    } else {
        alert(`¡Inventario actualizado correctamente para ${plato.name}! Stock actual: ${nuevoStockTotal}`);
        await cargarDatosDesdeSupabase();
    }
}

// ==================== CARTA Y CONFIGURACIÓN ====================
async function toggleCartaFestiva(isFestivaParam) {
    isCartaFestiva = isFestivaParam;
    isFestiva = isCartaFestiva;

    const { error } = await db.from('configuracion').update({ carta_festiva: isFestivaParam }).eq('id', 1);
    if (error) {
        alert('Error al actualizar la carta: ' + error.message);
        return;
    }

    actualizarInterfazCartaVisual();
    renderDishes('Todas');
}

function actualizarInterfazCartaVisual() {
    const chk = document.getElementById('chkFestiva');
    if (chk) chk.checked = isCartaFestiva;

    const lblNormal = document.getElementById('lblCartaNormal');
    const lblFestiva = document.getElementById('lblCartaFestiva');
    if (lblNormal) lblNormal.classList.toggle('active', !isCartaFestiva);
    if (lblFestiva) lblFestiva.classList.toggle('active', isCartaFestiva);

    const badge = document.getElementById('meseroCartaBadge');
    if (badge) {
        badge.innerText = isCartaFestiva ? "🎉 Carta Festiva Activa" : "📋 Carta Normal Activa";
        badge.style.color = isCartaFestiva ? "var(--accent-yellow)" : "var(--accent-green)";
    }
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
    try {
        const { data: comandasCobradas, error: errC } = await db.from('comandas').select('*, items_comanda(*)').eq('estado', 'cobrado');
        let totalVentas = 0;
        let costoVentas = 0;

        if (!errC && comandasCobradas) {
            comandasCobradas.forEach(c => {
                totalVentas += (parseFloat(c.total) || 0);
                if (c.items_comanda) {
                    c.items_comanda.forEach(item => {
                        let platoMatch = dishes.find(d => item.nombre_plato.includes(d.name));
                        if (platoMatch) {
                            costoVentas += (platoMatch.costo || 0);
                        }
                    });
                }
            });
        }

        const { data: gastos, error: errG } = await db.from('gastos').select('*');
        let totalGastos = 0;
        if (!errG && gastos) {
            totalGastos = gastos.reduce((acc, g) => acc + (parseFloat(g.monto) || 0), 0);
        }

        let utilidadBruta = totalVentas - costoVentas;
        let utilidadNeta = utilidadBruta - totalGastos;

        const kpiVentas = document.getElementById('kpiVentasTotal');
        const kpiGastos = document.getElementById('kpiGastosTotal');
        const kpiUtilidad = document.getElementById('kpiUtilidad');

        if (kpiVentas) kpiVentas.innerText = `S/ ${totalVentas.toFixed(2)}`;
        if (kpiGastos) kpiGastos.innerText = `S/ ${totalGastos.toFixed(2)}`;
        if (kpiUtilidad) {
            kpiUtilidad.innerText = `S/ ${utilidadNeta.toFixed(2)}`;
            kpiUtilidad.style.color = utilidadNeta >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
    } catch (err) {
        console.error("Error cargando finanzas:", err);
    }
}

async function buscarHistorialCliente() {
    const dni = document.getElementById('inputBuscarClienteDni').value.trim();
    const contenedor = document.getElementById('resultadoClienteConsumos');

    if (!dni) {
        alert('Ingresa el DNI del cliente a buscar.');
        return;
    }

    try {
        const { data: cliente, error: errCli } = await db.from('clientes').select('*').eq('dni', dni).single();
        if (errCli || !cliente) {
            contenedor.innerHTML = `<p style="color:var(--accent-red);">Cliente no encontrado con DNI ${dni}</p>`;
            return;
        }

        const { data: comandasCliente, error: errCom } = await db.from('comandas').select('*, items_comanda(*)').eq('cliente_dni', dni);

        let historialHtml = '';
        if (comandasCliente && comandasCliente.length > 0) {
            comandasCliente.forEach(c => {
                let itemsStr = c.items_comanda.map(i => `${i.nombre_plato} (S/ ${i.precio})`).join(', ');
                historialHtml += `
                    <div style="background:#1e1e24; padding:0.6rem; border-radius:6px; margin-bottom:0.5rem; font-size:0.85rem;">
                        <b>Mesa/Llevar:</b> ${c.mesa} | <b>Fecha:</b> ${new Date(c.created_at).toLocaleString()} | <b>Estado:</b> ${c.estado}<br>
                        <b>Ítems:</b> ${itemsStr}<br>
                        <strong style="color:var(--primary-color);">Total: S/ ${parseFloat(c.total).toFixed(2)}</strong>
                    </div>
                `;
            });
        } else {
            historialHtml = `<p class="text-muted">No registra consumos previos en comandas.</p>`;
        }

        contenedor.innerHTML = `
            <div style="background:#1e1e24; padding:1rem; border-radius:8px; margin-top:1rem; border:1px solid var(--border-color);">
                <h4>Cliente: ${cliente.nombre}</h4>
                <p><b>DNI:</b> ${cliente.dni} | <b>Teléfono:</b> ${cliente.telefono || 'N/A'}</p>
                <p><b>Consumo Acumulado Registrado:</b> S/ ${(parseFloat(cliente.consumo_total) || 0).toFixed(2)}</p>
                <hr style="margin: 0.8rem 0; border-color:var(--border-color);"/>
                <h5>Historial de Comandas:</h5>
                <div style="max-height: 250px; overflow-y: auto; margin-top: 0.5rem;">
                    ${historialHtml}
                </div>
            </div>
        `;
    } catch (e) {
        console.error("Error buscando cliente:", e);
    }
}

async function cargarClientesAdmin() {
    const tbody = document.getElementById('adminClientesTableBody');
    if (!tbody) return;

    try {
        const { data: clientes, error } = await db.from('clientes').select('*');
        if (error || !clientes || clientes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4">Sin registros de clientes.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        clientes.forEach(cli => {
            tbody.innerHTML += `
                <tr>
                    <td><b>${cli.dni}</b></td>
                    <td>${cli.nombre}</td>
                    <td>${cli.telefono || 'N/A'}</td>
                    <td>S/ ${(parseFloat(cli.consumo_total) || 0).toFixed(2)}</td>
                </tr>
            `;
        });
    } catch (err) {
        console.error("Error cargando clientes:", err);
    }
}

// ==================== GESTIÓN DE USUARIOS ====================
async function cargarUsuariosAdmin() {
    const tbody = document.getElementById('adminUsuariosTableBody');
    if (!tbody) return;

    try {
        const { data, error } = await db.from('usuarios').select('*');
        if (error) {
            tbody.innerHTML = `<tr><td colspan="5" style="color:var(--accent-red);">Error al cargar usuarios.</td></tr>`;
            return;
        }

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">No hay usuarios registrados.</td></tr>`;
            return;
        }

        systemUsers = data;
        tbody.innerHTML = '';
        data.forEach(u => {
            let estadoBadge = u.activo 
                ? `<span style="color:var(--accent-green); font-weight:600;">Activo</span>` 
                : `<span style="color:var(--accent-red); font-weight:600;">Desactivado</span>`;

            tbody.innerHTML += `
                <tr>
                    <td><b>${u.usuario}</b></td>
                    <td>${u.nombre_completo}</td>
                    <td><span class="loyalty-tag">${u.rol.toUpperCase()}</span></td>
                    <td>${estadoBadge}</td>
                    <td>
                        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                            <button class="btn btn-secondary btn-sm" onclick="abrirEditarUsuario(${u.id})">✏️ Editar</button>
                            <button class="btn ${u.activo ? 'btn-secondary' : 'btn-success'} btn-sm" onclick="toggleEstadoUsuario(${u.id}, ${!u.activo})">${u.activo ? '🚫 Desactivar' : '✅ Activar'}</button>
                            <button class="btn btn-danger btn-sm" onclick="eliminarUsuario(${u.id})" style="background:var(--accent-red); color:#fff;">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error("Error cargando usuarios:", e);
    }
}

async function crearUsuarioTrabajador(e) {
    e.preventDefault();
    const usuario = document.getElementById('usrUser').value.trim();
    const nombre_completo = document.getElementById('usrNombre').value.trim();
    const password = document.getElementById('usrPass').value.trim();
    const rol = document.getElementById('usrRol').value;

    const { error } = await db.from('usuarios').insert([{ usuario, nombre_completo, password, rol, activo: true }]);
    if (error) { 
        alert('Error al crear usuario: ' + error.message); 
    } else {
        alert('¡Trabajador creado con éxito!');
        e.target.reset();
        cargarUsuariosAdmin();
    }
}

function abrirEditarUsuario(id) {
    const user = systemUsers.find(u => u.id === id);
    if (!user) return;

    document.getElementById('editUsrId').value = user.id;
    document.getElementById('editUsrUser').value = user.usuario;
    document.getElementById('editUsrNombre').value = user.nombre_completo;
    document.getElementById('editUsrPass').value = '';
    document.getElementById('editUsrRol').value = user.rol;

    document.getElementById('editUserModal').classList.remove('hidden');
}

function closeEditUserModal() {
    document.getElementById('editUserModal').classList.add('hidden');
}

async function actualizarUsuarioTrabajador(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('editUsrId').value);
    const usuario = document.getElementById('editUsrUser').value.trim();
    const nombre_completo = document.getElementById('editUsrNombre').value.trim();
    const password = document.getElementById('editUsrPass').value.trim();
    const rol = document.getElementById('editUsrRol').value;

    let updateData = { usuario, nombre_completo, rol };
    if (password) updateData.password = password;

    const { error } = await db.from('usuarios').update(updateData).eq('id', id);
    if (error) {
        alert('Error al actualizar usuario: ' + error.message);
    } else {
        alert('¡Usuario actualizado correctamente!');
        closeEditUserModal();
        cargarUsuariosAdmin();
    }
}

async function toggleEstadoUsuario(id, nuevoEstado) {
    const { error } = await db.from('usuarios').update({ activo: nuevoEstado }).eq('id', id);
    if (error) {
        alert('Error al cambiar estado: ' + error.message);
    } else {
        cargarUsuariosAdmin();
    }
}

async function eliminarUsuario(id) {
    if (!confirm('¿Estás seguro de eliminar permanentemente este usuario?')) return;

    const { error } = await db.from('usuarios').delete().eq('id', id);
    if (error) {
        alert('Error al eliminar usuario: ' + error.message);
    } else {
        alert('Usuario eliminado correctamente.');
        cargarUsuariosAdmin();
    }
}

async function agregarPlato(event) {
    event.preventDefault();
    const nombre = document.getElementById('platoNombre').value;
    const precio = parseFloat(document.getElementById('platoPrecio').value);
    const festivoVal = document.getElementById('platoFestivo').value;
    const festivo = festivoVal ? parseFloat(festivoVal) : precio;
    const costo = parseFloat(document.getElementById('platoCosto').value) || 0;
    const stock = parseInt(document.getElementById('platoStock').value) || 0;
    const categoria = document.getElementById('platoCategoria').value;

    const { error } = await db.from('platos').insert([{ nombre, categoria, precio, festivo, costo, stock }]);
    if (error) { 
        alert('Error: ' + error.message); 
    } else {
        alert('Producto agregado con éxito');
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
                    <span><b>${d.name}</b> (Stock: ${d.stock})</span>
                    <div style="text-align: right;">
                        <span class="menu-item-prices">P.Venta: S/ ${d.price.toFixed(2)} | Costo: S/ ${d.costo.toFixed(2)}</span>
                        <div class="menu-item-fest">Fest. S/ ${d.festivo.toFixed(2)}</div>
                    </div>
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

    const ordersContainer = document.getElementById('adminActiveOrdersContainer');
    if (!ordersContainer) return;

    const activeOrders = kitchenOrders.filter(o => o.status !== 'cobrado');
    if (activeOrders.length === 0) {
        ordersContainer.innerHTML = `<p class="text-muted">No hay pedidos o mesas ocupadas en este momento.</p>`;
        return;
    }

    ordersContainer.innerHTML = '';
    activeOrders.forEach(ord => {
        let itemsHtml = ord.items.map(i => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#1e1e24; padding:0.4rem 0.8rem; border-radius:6px; margin-bottom:0.3rem; font-size:0.85rem;">
                <span>${i.name} - <b>S/ ${i.price.toFixed(2)}</b></span>
                <button class="btn btn-danger btn-sm" onclick="eliminarItemComandaSeguro(${ord.id}, ${i.id})" style="padding:0.1rem 0.4rem; font-size:0.7rem; background:var(--accent-red); color:#fff;" title="Eliminar ítem">🗑️</button>
            </div>
        `).join('');

        ordersContainer.innerHTML += `
            <div style="background:#2b2d42; border:1px solid var(--border-color); border-radius:8px; padding:1rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                    <h4 style="color:var(--primary-color);">🍽️ ${ord.table} <span style="font-size:0.85rem; color:var(--accent-yellow);">(${ord.cliente_nombre})</span></h4>
                    <span style="font-size:0.85rem;" class="loyalty-tag">Estado: ${ord.status.toUpperCase()} | Total: S/ ${ord.total.toFixed(2)}</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    ${itemsHtml}
                </div>
            </div>
        `;
    });
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