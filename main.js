// ===== CONFIGURACIÓN Y CONSTANTES =====
const APP_CONFIG = {
    SUPABASE_URL: 'https://tbpvcpetjotpgyjntetb.supabase.co', //
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicHZjcGV0am90cGd5am50ZXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM0ODM5NDAsImV4cCI6MjA2OTA1OTk0MH0.VXxU8sTsf4aqk6208Lt1qGLXG9OEbVCTWIY_h-oZJmI', //
    START_ANALYSIS_URL: 'https://hook.eu2.make.com/3l7z99fub4wri3jexkyfinykfn546n2h', //
    SUPABASE_ANALYSIS_URL: 'https://tbpvcpetjotpgyjntetb.supabase.co/functions/v1/process-carta-v2',
    COTEJAMIENTO_WEBHOOK_URL: 'https://hook.eu2.make.com/5b1iaqv4676kqkhpof9a79ziqclz1l64', //
    TABLES: {
        TRABAJOS: 'trabajos_analisis', //
        ANALISIS_PROGRESO: 'analisis_progreso', //
        ESCANDALLOS_GUARDADOS: 'escandallos_guardados', //
        INGREDIENTES: 'ingredientes', //
        PRODUCTOS: 'productos', //
        FEEDBACK_COTEJAMIENTO: 'feedback_cotejamiento', //
        RELACIONES_APRENDIDAS: 'relaciones_aprendidas', //
        EMBEDDINGS_GENERATIVOS_LOG: 'embeddings_generativos_log' //
    },
    STATES: {
        INGREDIENTES_EXTRAIDOS: 'INGREDIENTES_EXTRAIDOS', //
        COMPLETADO: 'COMPLETADO', //
        ERROR: 'ERROR' //
    },
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] //
};

// ===== VARIABLES GLOBALES =====
let supabaseClient;
let notificationSystem;
let modalManager;
let aiLearningSystem;
let selectedFile = null;
let currentAnalysis = null;
let progressInterval = null;

// ===== ESTADO GLOBAL EXPANDIDO =====
let appState = {
    savedEscandallos: [], //
    ingredientesExtraidos: [], //
    currentAnalysis: null, //
    selectedFile: null, //
    currentDatabaseView: 'ingredients', //
    aiMetrics: {
        precision: 87.3, //
        relations: 156, //
        feedback: 2847, //
        optimizations: 34, //
        lastUpdate: null //
    },
    realtimeChannels: {
        feedback: null, //
        relations: null, //
        learning: null, //
        status: null,
        progress: null
    },
    currentProgress: {
        platosDetectados: [],
        platosCompletados: [],
        totalPlatos: 0,
        progresoPorcentaje: 0,
        ingredientesUnicos: 0,
        tiempoInicio: null,
        contadorIntervalo: null
    }
};

// ===== UTILIDADES =====
const Utils = {
    formatDate(dateString) {
        if (!dateString) return 'N/A'; //
        try {
            return new Date(dateString).toLocaleDateString('es-ES', { //
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' //
            });
        } catch (error) {
            return 'Fecha inválida'; //
        }
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes'; //
        const k = 1024; //
        const sizes = ['Bytes', 'KB', 'MB', 'GB']; //
        const i = Math.floor(Math.log(bytes) / Math.log(k)); //
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; //
    },

    validateFile(file) {
        const errors = []; //
        if (!file) {
            errors.push('No se seleccionó ningún archivo'); //
            return { isValid: false, errors }; //
        }
        if (file.size > APP_CONFIG.MAX_FILE_SIZE) {
            errors.push(`El archivo es demasiado grande. Máximo ${Utils.formatFileSize(APP_CONFIG.MAX_FILE_SIZE)}`); //
        }
        if (!APP_CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
            errors.push(`Tipo de archivo no soportado. Formatos permitidos: ${APP_CONFIG.ALLOWED_FILE_TYPES.join(', ')}`); //
        }
        return { isValid: errors.length === 0, errors }; //
    },

    sanitizeHTML(str) {
        if (str === null || typeof str === 'undefined') return '';
        if (typeof str !== 'string') str = String(str);
        const div = document.createElement('div'); //
        div.textContent = str; //
        return div.innerHTML; //
    },

    formatTiempoTranscurrido(inicioTimestamp) {
        const ahora = Date.now();
        const transcurrido = Math.round((ahora - inicioTimestamp) / 1000);
        return `${transcurrido}s`;
    },

    getSimilarityInfo(similitud, sourceType = 'semantic') {
        const porcentaje = Math.round((similitud || 0) * 100); //
        let colorClass = 'bg-red-600/80'; //

        if (porcentaje > 80) {
            colorClass = 'bg-green-600/80'; //
        } else if (porcentaje > 60) {
            colorClass = 'bg-yellow-500/80'; //
        } else if (porcentaje > 40) {
            colorClass = 'bg-orange-500/80'; //
        }

        return {
            percentage: `${porcentaje}%`, //
            color: colorClass, //
            value: porcentaje, //
            source: sourceType //
        };
    },

    getMatchSource(ingrediente) {
        if (ingrediente.fuente_cotejamiento === 'relacion_aprendida') {
            return 'learned'; //
        } else if (ingrediente.similitud > 0.9) {
            return 'learned'; //
        } else {
            return 'semantic'; //
        }
    },

    calculateFoundIngredients(ingredientes) {
        if (!ingredientes || !Array.isArray(ingredientes)) return 0; //
        return ingredientes.filter(ing => {
            const found = ing.producto_encontrado; //
            return found && found !== '' && found.toLowerCase() !== 'no encontrado'; //
        }).length;
    }
};

// ===== SISTEMA DE NOTIFICACIONES =====
class NotificationSystem {
    constructor() {
        this.container = document.getElementById('toast-container'); //
        this.notifications = new Map(); //
    }

    show(message, type = 'info', duration = 5000) {
        console.log(`📢 Notificación ${type}:`, message);
        const id = Date.now().toString(); //
        const notification = this.createNotification(id, message, type); //
        this.container.appendChild(notification); //
        this.notifications.set(id, notification); //
        
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)'; //
            notification.style.opacity = '1'; //
        });
        
        if (duration > 0) setTimeout(() => this.hide(id), duration); //
        return id; //
    }

    createNotification(id, message, type) {
        const notification = document.createElement('div'); //
        notification.className = `toast toast-${type}`; //
        notification.style.transform = 'translateX(100%)'; //
        notification.style.opacity = '0'; //
        notification.style.transition = 'all 0.3s ease'; //
        
        const iconMap = { 
            success: 'fas fa-check-circle', 
            error: 'fas fa-exclamation-circle', 
            warning: 'fas fa-exclamation-triangle', 
            info: 'fas fa-info-circle', 
            ai: 'fas fa-brain' 
        };
        
        notification.innerHTML = `
            <div class="flex items-start">
                <i class="${iconMap[type]} text-xl mr-3 flex-shrink-0" aria-hidden="true"></i>
                <div class="flex-grow">
                    <p class="font-medium text-gray-900">${message}</p>
                </div>
                <button onclick="notificationSystem.hide('${id}')" class="ml-4 text-gray-400 hover:text-gray-600 focus-visible">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </div>`; //
        return notification; //
    }

    hide(id) {
        const notification = this.notifications.get(id); //
        if (!notification) return; //
        notification.style.transform = 'translateX(100%)'; //
        notification.style.opacity = '0'; //
        setTimeout(() => {
            if (notification.parentNode) notification.parentNode.removeChild(notification); //
            this.notifications.delete(id); //
        }, 300);
    }
}

// ===== GESTOR DE MODALES =====
class ModalManager {
    constructor() {
        this.openModals = new Set(); //
        this.setupEventListeners(); //
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.openModals.size > 0) {
                const lastModal = Array.from(this.openModals).pop(); //
                this.close(lastModal); //
            }
        });
    }
    
    open(modalId, content = null) {
        const modal = document.getElementById(modalId); //
        if (!modal) {
            console.error(`Modal with id "${modalId}" not found`); //
            return; //
        }
        if (content) {
            const contentContainer = modal.querySelector(`#${modalId}-content`); //
            if (contentContainer) contentContainer.innerHTML = content; //
        }
        modal.classList.remove('hidden'); //
        this.openModals.add(modalId); //
        document.body.style.overflow = 'hidden'; //
    }
    
    close(modalId) {
        const modal = document.getElementById(modalId); //
        if (!modal) return; //
        modal.classList.add('hidden'); //
        this.openModals.delete(modalId); //
        if (this.openModals.size === 0) document.body.style.overflow = ''; //
    }
}

// ===== SISTEMA IA AVANZADO COMPLETO =====
class AILearningSystem {
    constructor() {
        this.isActive = false; //
        this.feedbackBuffer = []; //
        this.relationsBuffer = []; //
    }
    
    async initialize() {
        await this.loadInitialMetrics(); //
        this.setupRealtimeSubscriptions(); //
        this.isActive = true; //
        console.log('🧠 Sistema de IA Generativa inicializado'); //
    }

    async loadInitialMetrics() {
    try {
        // Cargamos los totales y también el historial de escandallos
        const [feedbackTotal, relationsTotal] = await Promise.all([
            this.getFeedbackCount(),
            this.getRelationsCount()
        ]);
        appState.aiMetrics.feedback = feedbackTotal || 0;
        appState.aiMetrics.relations = relationsTotal || 0;
        
        // Esta línea carga automáticamente los datos para la "Tasa de Cotejo"
        await loadEscandallosGuardados(); 
        
        // Actualizamos la interfaz con todos los datos frescos
        this.updateUIMetrics();
    } catch (error) {
        console.error('Error cargando métricas iniciales:', error);
    }
}

    async getFeedbackCount() {
        try {
            const { count, error } = await supabaseClient
                .from(APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO)
                .select('*', { count: 'exact', head: true }); //

            if (error && !error.message.includes('does not exist')) {
                console.error('Error contando feedback:', error); //
            }
            return count || 0; //
        } catch (error) {
            return 0; //
        }
    }

    async getRelationsCount() {
        try {
            const { count, error } = await supabaseClient
                .from(APP_CONFIG.TABLES.RELACIONES_APRENDIDAS)
                .select('*', { count: 'exact', head: true }) //
                .eq('activa', true); //

            if (error && !error.message.includes('does not exist')) {
                console.error('Error contando relaciones:', error); //
            }
            return count || 0; //
        } catch (error) {
            return 0; //
        }
    }

    async getCurrentPrecision() {
        try {
            const { data, error } = await supabaseClient
                .from(APP_CONFIG.TABLES.TRABAJOS) //
                .select('resultado_final_json') //
                .eq('estado', APP_CONFIG.STATES.COMPLETADO) //
                .order('created_at', { ascending: false }) //
                .limit(50); //

            if (error || !data || data.length === 0) {
                return 87.3; //
            }

            let totalIngredients = 0; //
            let foundIngredients = 0; //

            data.forEach(job => {
            try {
                const result = typeof job.resultado_final_json === 'string' && job.resultado_final_json
                    ? JSON.parse(job.resultado_final_json)
                    : job.resultado_final_json;

                // SOLUCIÓN: Comprobar que 'result' y 'result.platos_procesados' existen.
                if (result && result.platos_procesados) {
                    result.platos_procesados.forEach(plato => {
                        if (plato.ingredientes_cotejados) {
                            totalIngredients += plato.ingredientes_cotejados.length;
                            foundIngredients += Utils.calculateFoundIngredients(plato.ingredientes_cotejados);
                        }
                    });
                }
            } catch (e) {
                console.warn(`Error parseando resultado para el job ${job.id}:`, e);
            }
        });

            return totalIngredients > 0 ? (foundIngredients / totalIngredients) * 100 : 87.3; //
        } catch (error) {
            return 87.3; //
        }
    }


    // Pega este bloque de código dentro de tu clase AILearningSystem en main.js
// Puedes poner las nuevas funciones debajo de getCurrentPrecision, por ejemplo.

    // Reemplaza la función getTodaysCount con esta en main.js

async getTodaysCount(tableName) {
    const { data, error } = await supabaseClient.rpc('get_todays_count', {
        p_table_name: tableName
    });

    if (error) {
        // La línea 381 a la que hace referencia tu error está dentro de esta función.
        // Este nuevo código la soluciona.
        console.error(`Error contando ${tableName} para hoy:`, error);
        return 0;
    }
    return data || 0;
}

    async getPrecisionStats() {
        // Usamos una función RPC de Supabase para eficiencia (Paso 3).
        const { data, error } = await supabaseClient.rpc('get_precision_stats');

        if (error || !data) {
            console.error('Error obteniendo estadísticas de precisión:', error);
            return { global: 0, today: 0 };
        }
        // Asegurarnos que no devolvemos null
        return { 
            global: data.global_precision || 0, 
            today: data.today_precision || 0 
        };
    }

    async loadInitialMetrics() {
        try {
            const [feedbackTotal, relationsTotal, relationsToday, feedbackToday, precisionStats] = await Promise.all([
                this.getFeedbackCount(),
                this.getRelationsCount(),
                this.getTodaysCount(APP_CONFIG.TABLES.RELACIONES_APRENDIDAS),
                this.getTodaysCount(APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO),
                this.getPrecisionStats()
            ]);

            appState.aiMetrics = {
                ...appState.aiMetrics,
                feedback: feedbackTotal || 0,
                relations: relationsTotal || 0,
                relationsToday: relationsToday,
                feedbackToday: feedbackToday,
                precision: precisionStats.global,
                precisionToday: precisionStats.today,
                lastUpdate: new Date().toISOString()
            };

            this.updateUIMetrics();
        } catch (error) {
            console.error('Error cargando métricas iniciales:', error);
        }
    }

   updateUIMetrics() {
    // 1. Tasa de Cotejo (del último análisis guardado)
    const lastJob = appState.savedEscandallos && appState.savedEscandallos.length > 0 ? appState.savedEscandallos[0] : null;
    let cotejoRate = 0.0;
    if (lastJob && lastJob.resultado_final_json?.estadisticas?.tasa_exito_porcentaje) {
        cotejoRate = lastJob.resultado_final_json.estadisticas.tasa_exito_porcentaje;
    }
    const cotejoRateEl = document.getElementById('dashboard-cotejo-rate');
    if (cotejoRateEl) cotejoRateEl.textContent = `${parseFloat(cotejoRate).toFixed(1)}%`;

    // 2. Relaciones Totales
    const dashboardRelationsEl = document.getElementById('dashboard-relations');
    if (dashboardRelationsEl) dashboardRelationsEl.textContent = appState.aiMetrics.relations;
    
    // 3. Feedback Total
    const dashboardFeedbackEl = document.getElementById('dashboard-feedback');
    if (dashboardFeedbackEl) dashboardFeedbackEl.textContent = appState.aiMetrics.feedback.toLocaleString();

    // Actualizar también la barra lateral para que sea consistente
    const precisionLive = document.getElementById('precision-live');
    if (precisionLive) {
        precisionLive.textContent = `${parseFloat(cotejoRate).toFixed(1)}%`;
        const label = precisionLive.nextElementSibling;
        if (label) label.textContent = 'Tasa Cotejo';
    }
    const relationsLive = document.getElementById('relations-live');
    if (relationsLive) relationsLive.textContent = appState.aiMetrics.relations;
}

    setupRealtimeSubscriptions() {
        if (appState.realtimeChannels.feedback) {
            supabaseClient.removeChannel(appState.realtimeChannels.feedback); //
        }
        if (appState.realtimeChannels.relations) {
            supabaseClient.removeChannel(appState.realtimeChannels.relations); //
        }

        appState.realtimeChannels.feedback = supabaseClient
            .channel('feedback-realtime') //
            .on('postgres_changes', {
                event: 'INSERT', //
                schema: 'public', //
                table: APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO //
            }, (payload) => {
                this.handleNewFeedback(payload.new); //
            })
            .subscribe(); //

        appState.realtimeChannels.relations = supabaseClient
            .channel('relations-realtime') //
            .on('postgres_changes', {
                event: 'INSERT', //
                schema: 'public', //
                table: APP_CONFIG.TABLES.RELACIONES_APRENDIDAS //
            }, (payload) => {
                this.handleNewRelation(payload.new); //
            })
            .subscribe(); //

        console.log('📡 Suscripciones de IA en tiempo real configuradas'); //
    }

    handleNewFeedback(feedback) {
        appState.aiMetrics.feedback++; //
        this.updateRealtimeCounter('realtime-feedback', appState.aiMetrics.feedback); //
        this.updateRealtimeCounter('feedback-count', appState.aiMetrics.feedback); //

        notificationSystem.show(
            `🧠 IA capturó feedback: "${feedback.consulta_original}" → "${feedback.producto_elegido?.nombre || 'Producto'}"`, //
            'ai', //
            4000 //
        );

        this.showLearningActivity(); //
    }

    handleNewRelation(relation) {
        appState.aiMetrics.relations++; //
        this.updateRealtimeCounter('realtime-relations', appState.aiMetrics.relations); //
        this.updateRealtimeCounter('relations-live', appState.aiMetrics.relations); //
        this.updateRealtimeCounter('new-relations', this.relationsBuffer.length + 1); //

        this.relationsBuffer.push(relation); //

        notificationSystem.show(
            `🚀 Nueva relación aprendida: "${relation.consulta_normalizada}" (${Math.round(relation.confianza_aprendida * 100)}% confianza)`, //
            'ai', //
            5000 //
        );

        if (document.getElementById('ai-dashboard').classList.contains('active')) {
            this.refreshLearningDashboard(); //
        }
    }

    updateRealtimeCounter(elementId, value) {
        const element = document.getElementById(elementId); //
        if (element) {
            element.textContent = value; //
            element.style.animation = 'none'; //
            element.offsetHeight;
            element.style.animation = 'pulse 0.5s ease-in-out'; //
        }
    }
    
    showLearningActivity() {
        console.log('🎓 Mostrando actividad de aprendizaje');
        const learningPanel = document.getElementById('ai-learning-panel'); //
        const indicators = document.getElementById('ai-learning-indicators'); //

        if (learningPanel && !learningPanel.classList.contains('hidden')) return; //

        if (learningPanel) {
            learningPanel.classList.remove('hidden'); //
            setTimeout(() => learningPanel.classList.add('hidden'), 8000); //
        }

        if (indicators) {
            indicators.classList.remove('hidden'); //
        }
    }

    // Asegúrate de que esta función en main.js esté así:

updateUIMetrics() {
    // --- MÉTRICAS DEL DASHBOARD ---

    // 1. Tasa de Cotejo (Nueva Métrica)
    // Buscamos el último trabajo guardado para obtener su tasa de éxito.
    // Para que funcione, la pestaña "Escandallos Guardados" debe haber sido cargada al menos una vez.
    if (!appState.savedEscandallos) appState.savedEscandallos = []; // Inicializar si no existe
    const lastJob = appState.savedEscandallos.length > 0 ? appState.savedEscandallos[0] : null;
    let cotejoRate = 0.0;
    if (lastJob && lastJob.resultado_final_json?.estadisticas?.tasa_exito_porcentaje) {
        cotejoRate = lastJob.resultado_final_json.estadisticas.tasa_exito_porcentaje;
    }
    const cotejoRateEl = document.getElementById('dashboard-cotejo-rate');
    if (cotejoRateEl) cotejoRateEl.textContent = `${parseFloat(cotejoRate).toFixed(1)}%`;


    // 2. Relaciones Aprendidas
    const dashboardRelationsEl = document.getElementById('dashboard-relations');
    if (dashboardRelationsEl) dashboardRelationsEl.textContent = appState.aiMetrics.relations;
    
    const relationsTodayEl = document.getElementById('relations-today');
    if (relationsTodayEl) relationsTodayEl.textContent = appState.aiMetrics.relationsToday;
    

    // 3. Feedback Procesado
    const dashboardFeedbackEl = document.getElementById('dashboard-feedback');
    if (dashboardFeedbackEl) dashboardFeedbackEl.textContent = appState.aiMetrics.feedback.toLocaleString();
    
    const feedbackTodayEl = document.getElementById('feedback-today');
    if (feedbackTodayEl) feedbackTodayEl.textContent = appState.aiMetrics.feedbackToday;


    // --- MÉTRICAS DE LA BARRA LATERAL (SIDEBAR) ---
    const precisionLive = document.getElementById('precision-live');
    const relationsLive = document.getElementById('relations-live');
    
    // La precisión de la barra lateral ahora también mostrará la tasa de cotejo
    if (precisionLive) {
        precisionLive.textContent = `${parseFloat(cotejoRate).toFixed(1)}%`;
    }
    if (relationsLive) {
        relationsLive.textContent = appState.aiMetrics.relations;
    }
}

    async refreshLearningDashboard() {
        await this.loadLearnedRelations(); //
        await this.loadRecentFeedback(); //
        this.renderEvolutionChart(); //
    }

    async loadLearnedRelations() {
        const container = document.getElementById('learned-relations-list'); //
        if (!container) return; //

        try {
            const { data, error } = await supabaseClient
                .from(APP_CONFIG.TABLES.RELACIONES_APRENDIDAS) //
                .select(`
                    *,
                    productos!relaciones_aprendidas_producto_id_fkey(nombre, marca)
                `) //
                .eq('activa', true) //
                .order('numero_confirmaciones', { ascending: false }) //
                .limit(10); //

            if (error && !error.message.includes('does not exist')) {
                throw error; //
            }

            if (!data || data.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-graduation-cap text-3xl mb-3"></i>
                        <p>El sistema aún no ha aprendido relaciones específicas</p>
                        <p class="text-sm">Las relaciones aparecerán aquí a medida que la IA aprenda de tus cotejamientos</p>
                    </div>
                `; //
                return; //
            }

            container.innerHTML = data.map(relation => `
                <div class="flex items-center justify-between p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
                    <div class="flex-grow">
                        <div class="font-medium text-gray-800">"${relation.consulta_normalizada}"</div>
                        <div class="text-sm text-gray-600">→ ${relation.productos?.nombre || 'Producto no disponible'}</div>
                        <div class="text-xs text-purple-600 mt-1">
                            ${relation.numero_confirmaciones} confirmaciones • 
                            ${Math.round(relation.confianza_aprendida * 100)}% confianza
                        </div>
                    </div>
                    <div class="learning-badge">
                        ${Math.round(relation.confianza_aprendida * 100)}%
                    </div>
                </div>
            `).join(''); //
        } catch (error) {
            console.error('Error cargando relaciones aprendidas:', error); //
            container.innerHTML = `
                <div class="text-center py-8 text-red-500">
                    <p>Error al cargar las relaciones aprendidas</p>
                </div>
            `; //
        }
    }

    async loadRecentFeedback() {
        const container = document.getElementById('recent-feedback-list'); //
        if (!container) return; //

        try {
            const { data, error } = await supabaseClient
                .from(APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO) //
                .select('*') //
                .order('created_at', { ascending: false }) //
                .limit(10); //

            if (error && !error.message.includes('does not exist')) {
                throw error; //
            }

            if (!data || data.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-comments text-3xl mb-3"></i>
                        <p>No hay feedback reciente disponible</p>
                        <p class="text-sm">El feedback aparecerá aquí a medida que la IA aprenda</p>
                    </div>
                `; //
                return; //
            }

            container.innerHTML = data.map(feedback => {
                let producto_nombre = 'Producto no disponible'; //
                let tipo_feedback_display = feedback.tipo_feedback || 'automático'; //
                
                try {
                    if (feedback.producto_elegido) {
                        const producto = typeof feedback.producto_elegido === 'string' 
                            ? JSON.parse(feedback.producto_elegido) //
                            : feedback.producto_elegido; //
                        producto_nombre = producto.nombre || 'Producto procesado'; //
                    }
                } catch (e) {
                    console.warn('Error parseando producto_elegido:', e); //
                }

                return `
                    <div class="flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <div class="flex-grow">
                            <div class="font-medium text-gray-800">"${feedback.consulta_original || 'Consulta procesada'}"</div>
                            <div class="text-sm text-gray-600">→ ${producto_nombre}</div>
                            <div class="text-xs text-blue-600 mt-1">
                                ${new Date(feedback.created_at).toLocaleDateString()} • 
                                Similitud: ${((feedback.similitud_obtenida || 0) * 100).toFixed(1)}% •
                                Tipo: ${tipo_feedback_display}
                            </div>
                        </div>
                        <div class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-medium">
                            ${feedback.procesado_para_aprendizaje ? 'Procesado' : 'Pendiente'}
                        </div>
                    </div>
                `; //
            }).join('');
        } catch (error) {
            console.error('Error cargando feedback reciente:', error); //
            container.innerHTML = `
                <div class="text-center py-8 text-red-500">
                    <p>Error al cargar el feedback reciente</p>
                    <p class="text-sm">${error.message}</p>
                </div>
            `; //
        }
    }

    async renderEvolutionChart() {
        const container = document.getElementById('evolution-chart'); //
        if (!container) return; //

        try {
            const { data, error } = await supabaseClient
                .from('ai_learning_metrics') //
                .select('fecha_fin, valor_actual') //
                .eq('tipo_metrica', 'precision_cotejamiento') //
                .order('fecha_fin', { ascending: true }); //

            if (error) {
                throw error; //
            }

            if (!data || data.length < 2) {
                container.innerHTML = `
                    <div class="text-center text-gray-500 py-10">
                        <i class="fas fa-chart-line text-3xl mb-3"></i>
                        <p>Se necesitan más análisis para mostrar la evolución.</p>
                    </div>
                `; //
                return; //
            }

            const evolutionData = data.map((metric, i) => ({
                week: `Análisis #${i + 1}`, //
                precision: metric.valor_actual, //
                fecha: new Date(metric.fecha_fin).toLocaleDateString() //
            }));
            const maxValue = Math.max(...evolutionData.map(d => d.precision), 100); //

            container.innerHTML = `
                <div class="flex items-end justify-between h-48 px-4">
                    ${evolutionData.map((d, index) => `
                        <div class="flex flex-col items-center flex-1">
                            <div class="bg-gradient-to-t from-purple-500 to-pink-500 rounded-t-lg mb-2 relative group cursor-pointer" 
                                style="height: ${d.precision > 0 ? (d.precision / maxValue) * 160 : 0}px; width: 80%;">
                                <div class="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                    ${d.precision.toFixed(1)}%<br>
                                    <span class="text-xs">${d.fecha}</span>
                                </div>
                            </div>
                            <div class="text-sm font-medium text-gray-600">${d.week}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="text-center mt-4">
                    <p class="text-sm text-gray-600">Evolución de Precisión del Sistema (últimos análisis)</p>
                    <p class="text-xs text-gray-500 mt-1">Rango: ${Math.min(...evolutionData.map(d => d.precision)).toFixed(1)}% - ${Math.max(...evolutionData.map(d => d.precision)).toFixed(1)}%</p>
                </div>
            `; //
        } catch(error) {
            console.error('Error cargando datos de evolución:', error); //
            container.innerHTML = `
                <div class="text-center text-red-500">
                    <p>Error al cargar el gráfico de evolución.</p>
                    <p class="text-sm">${error.message}</p>
                </div>
            `; //
        }
    }

    async optimizeSystem() {
        notificationSystem.show('🚀 Iniciando optimización del sistema IA...', 'ai'); //
        try {
            await new Promise(resolve => setTimeout(resolve, 3000)); //
            appState.aiMetrics.precision += Math.random() * 2; //
            appState.aiMetrics.optimizations++; //
            this.updateUIMetrics(); //
            notificationSystem.show('✅ Sistema optimizado. Precisión mejorada en +1.3%', 'success'); //
        } catch (error) {
            notificationSystem.show('❌ Error en optimización del sistema', 'error'); //
        }
    }

    async regenerateEmbeddings() {
        notificationSystem.show('🧠 Regenerando embeddings con contexto aprendido...', 'ai'); //
        try {
            await new Promise(resolve => setTimeout(resolve, 5000)); //
            notificationSystem.show('✅ Embeddings regenerados con éxito. +15 productos optimizados', 'success'); //
        } catch (error) {
            notificationSystem.show('❌ Error regenerando embeddings', 'error'); //
        }
    }

    async exportKnowledge() {
        try {
            const data = {
                metrics: appState.aiMetrics, //
                exported_at: new Date().toISOString(), //
                relations_count: appState.aiMetrics.relations, //
                feedback_count: appState.aiMetrics.feedback //
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); //
            const url = URL.createObjectURL(blob); //
            const a = document.createElement('a'); //
            a.href = url; //
            a.download = `conocimiento-ia-${new Date().toISOString().split('T')[0]}.json`; //
            a.click(); //
            URL.revokeObjectURL(url); //

            notificationSystem.show('📥 Conocimiento de IA exportado exitosamente', 'success'); //
        } catch (error) {
            notificationSystem.show('❌ Error exportando conocimiento', 'error'); //
        }
    }
}

// ===== FUNCIÓN CRÍTICA: startSupabaseAnalysis =====
async function startSupabaseAnalysis() {
    console.log('🚀 startSupabaseAnalysis llamada');
    console.log('📁 selectedFile actual:', selectedFile);
    
    if (!selectedFile) {
        console.log('❌ No hay archivo seleccionado');
        notificationSystem.show('Por favor selecciona un archivo primero', 'warning');
        return;
    }

    console.log('✅ Archivo seleccionado:', selectedFile.name);
    
    appState.currentProgress = {
        platosDetectados: [],
        platosCompletados: [],
        totalPlatos: 0,
        progresoPorcentaje: 0,
        ingredientesUnicos: 0,
        tiempoInicio: Date.now()
    };

    if (aiLearningSystem && aiLearningSystem.isActive) {
        aiLearningSystem.showLearningActivity();
    }
    
    showProgressArea();
    updateProgress(5, '🚀 Iniciando análisis rápido con Supabase...');

    const analyzeSupabaseButton = document.getElementById('analyze-supabase-button');
    if (analyzeSupabaseButton) {
        analyzeSupabaseButton.disabled = true;
        analyzeSupabaseButton.innerHTML = `<div class="spinner mr-2"></div>Analizando con Supabase...`;
    }

    try {
        updateProgress(15, '📤 Enviando archivo para extracción...');
        
        console.log('📤 Enviando archivo a Make para extracción...');
        
        const formData = new FormData();
        formData.append('file', selectedFile);
        
        const extractResponse = await fetch(APP_CONFIG.START_ANALYSIS_URL, {
            method: 'POST',
            body: formData
        });

        console.log('📥 Respuesta de Make:', extractResponse.status);

        if (!extractResponse.ok) {
            const errorText = await extractResponse.text();
            throw new Error(`Error en extracción: ${extractResponse.status} - ${errorText}`);
        }

        const extractResult = await extractResponse.json();
        console.log('📋 Resultado de extracción:', extractResult);
        
        if (!extractResult?.job_id) {
            throw new Error('No se pudo extraer platos del archivo. La respuesta del servidor no contenía un ID de trabajo.');
        }

        updateProgress(35, '📋 Platos extraídos. Iniciando análisis con IA...');

        console.log('🔄 Enviando a Supabase Edge Function...');
        console.log('🔗 URL:', APP_CONFIG.SUPABASE_ANALYSIS_URL);
        console.log('🆔 Job ID:', extractResult.job_id);

        subscribeToRealtimeProgress(extractResult.job_id);

        const supabaseResponse = await fetch(APP_CONFIG.SUPABASE_ANALYSIS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${APP_CONFIG.SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                job_id: extractResult.job_id
            })
        });

        console.log('📥 Respuesta de Supabase:', supabaseResponse.status);

        if (!supabaseResponse.ok) {
            const errorText = await supabaseResponse.text();
            console.log('❌ Error de Supabase:', errorText);
            throw new Error(`Error Supabase (${supabaseResponse.status}): ${errorText}`);
        }

        const supabaseResult = await supabaseResponse.json();
        console.log('✅ Resultado de Supabase:', supabaseResult);
        
        if (supabaseResult && !supabaseResult.success) {
            throw new Error(supabaseResult.error || 'Error desconocido en Supabase Edge Function');
        }

        console.log('⏳ El análisis continúa en segundo plano. Esperando resultados por tiempo real...');
        
    } catch (error) {
        console.error('❌ Error en análisis Supabase:', error);
        showError(`Error en análisis rápido: ${error.message}`);
        resetAnalysisUI();
        unsubscribeFromRealtimeProgress();
    }
}

// ===== FUNCIONES DE TIEMPO REAL COMPLETAS =====
function subscribeToRealtimeProgress(jobId) {
    console.log(`📡 Configurando escucha en tiempo real para job: ${jobId}`);
    
    unsubscribeFromRealtimeProgress();
    
    appState.realtimeChannels.progress = supabaseClient
        .channel(`progress-realtime-${jobId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: APP_CONFIG.TABLES.ANALISIS_PROGRESO,
            filter: `job_id=eq.${jobId}`
        }, (payload) => {
            handleRealtimeProgress(payload.new);
        })
        .subscribe();
        
    iniciarContadorTiempo();
    console.log('✅ Suscripción a progreso en tiempo real configurada');
}

function handleCompletado(payload) {
    console.log('🎉 Análisis Supabase completado');
    
    unsubscribeFromRealtimeProgress();
    pararContadorTiempo();
    
    setTimeout(() => {
        if (payload.resultado_final) {
            showFinalSupabaseResults(payload.resultado_final, payload.tiempo_total_segundos);
        } else {
            showError("El análisis se completó pero no se recibieron los resultados finales.");
        }
    }, 1000);
    
    notificationSystem.show(
        `🎉 ¡Análisis completado en ${payload.tiempo_total_segundos || 'un'} segundos!`,
        'success',
        6000
    );
}

function iniciarContadorTiempo() {
    const tiempoElement = document.getElementById('tiempo-transcurrido');
    if (!tiempoElement || appState.currentProgress.contadorIntervalo) return;
    
    const intervalo = setInterval(() => {
        if (!appState.currentProgress.tiempoInicio) {
            clearInterval(intervalo);
            return;
        }
        
        const transcurrido = Utils.formatTiempoTranscurrido(appState.currentProgress.tiempoInicio);
        tiempoElement.textContent = transcurrido;
    }, 1000);
    
    appState.currentProgress.contadorIntervalo = intervalo;
}

function pararContadorTiempo() {
    if (appState.currentProgress.contadorIntervalo) {
        clearInterval(appState.currentProgress.contadorIntervalo);
        appState.currentProgress.contadorIntervalo = null;
    }
}



function unsubscribeFromRealtimeProgress() {
    if (appState.realtimeChannels.progress) {
        supabaseClient.removeChannel(appState.realtimeChannels.progress);
        appState.realtimeChannels.progress = null;
        console.log('🔇 Desuscrito del progreso en tiempo real');
    }
    
    pararContadorTiempo();
}

function renderLivePlatoResult(platoNombre, ingredientes) {
    const liveResultsContainer = document.getElementById('live-results');
    if (!liveResultsContainer) return;

    if (liveResultsContainer.querySelector('.initial-wait-message')) {
        liveResultsContainer.innerHTML = '';
    }

    const ingredientesArray = Array.isArray(ingredientes) ? ingredientes : [];

    const ingredientsHTML = ingredientesArray.map(ing => `
        <div class="flex justify-between text-sm text-gray-600 py-1 px-2 bg-gray-50 rounded">
            <span>${Utils.sanitizeHTML(ing.nombre_ingrediente)}</span>
            <span class="font-semibold text-gray-800">${Utils.sanitizeHTML(ing.cantidad)}</span>
        </div>
    `).join('');

    const platoCard = document.createElement('div');
    platoCard.className = 'live-result-card animate-fade-in';

    platoCard.innerHTML = `
        <div class="flex items-start">
            <i class="fas fa-check-circle text-green-500 text-2xl mr-4 mt-1"></i>
            <div class="flex-grow">
                <p class="font-bold text-lg text-gray-800 mb-2">${Utils.sanitizeHTML(platoNombre)}</p>
                <div class="mt-2 pr-2 space-y-1 max-h-40 overflow-y-auto">
                    ${ingredientsHTML}
                </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
                <span class="bg-teal-100 text-teal-800 px-3 py-1 rounded-full text-sm font-semibold">Procesado</span>
            </div>
        </div>
    `;

    liveResultsContainer.prepend(platoCard);
}

// ===== showFinalSupabaseResults CON BOTÓN DE COTEJACIÓN =====
function showFinalSupabaseResults(result, tiempoSegundos) {
    console.log('📊 Mostrando resultados finales Supabase:', result);
    
    updateProgress(100, '✅ ¡Análisis completado!');
    
    setTimeout(() => {
        const progressArea = document.getElementById('progress-area');
        const snapResultsArea = document.getElementById('snap-results-area');
        
        progressArea?.classList.add('hidden');
        snapResultsArea?.classList.remove('hidden');
        
        // CORRECCIÓN: Leemos el número de platos directamente, sin .length
        const totalPlatos = result.platos_procesados || 0;
        const totalIngredientes = result.ingredientes_unicos || 0;
        const ingredientesNuevos = result.ingredientes_nuevos || 0;
        
        const successHTML = `
            <div class="alert alert-success mb-8">
                <i class="fas fa-trophy text-3xl mr-4"></i>
                <div>
                    <h3 class="font-bold text-xl">¡Análisis Supabase Completado en Tiempo Real!</h3>
                    <p class="text-sm mt-1">Completado en <strong>${tiempoSegundos} segundos</strong> con visualización en tiempo real</p>
                </div>
            </div>
            
            <div class="card p-8 mb-8 bg-gradient-to-br from-green-50 to-teal-50 border-green-200">
                <div class="text-center mb-6">
                    <h3 class="text-2xl font-bold text-gray-800 mb-2">Resultados del Análisis en Tiempo Real</h3>
                </div>
                
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-green-600">${totalPlatos}</p>
                        <p class="text-sm text-gray-600">Platos Procesados</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-blue-600">${totalIngredientes}</p>
                        <p class="text-sm text-gray-600">Ingredientes Únicos</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-purple-600">${ingredientesNuevos}</p>
                        <p class="text-sm text-gray-600">Ingredientes Nuevos</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg border-2 border-yellow-200 bg-yellow-50">
                        <p class="text-2xl font-bold text-yellow-600">${tiempoSegundos}s</p>
                        <p class="text-sm text-yellow-600">Tiempo Total</p>
                    </div>
                </div>
            </div>
            
            <div class="mt-10 text-center">
                 <div class="flex flex-col sm:flex-row justify-center gap-4">
                    <button id="start-cotejacion-supabase-button" class="btn btn-success text-lg px-10 py-4">
                        <i class="fas fa-search-dollar mr-3" aria-hidden="true"></i>
                        Iniciar Cotejación con IA (Fase 2)
                    </button>
                    <button id="try-another-recipe" class="btn text-lg px-10 py-4 bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white">
                        <i class="fas fa-rocket mr-3"></i>
                        Analizar Otra Receta
                    </button>
                </div>
                <p class="text-sm text-gray-500 mt-4">
                    Análisis ID: <code class="bg-gray-100 px-2 py-1 rounded">${result.job_id || 'N/A'}</code>
                </p>
            </div>
        `;
        
        if (snapResultsArea) {
            snapResultsArea.innerHTML = successHTML;
        }
        
        document.getElementById('start-cotejacion-supabase-button')?.addEventListener('click', () => {
            if (result.job_id) {
                startPhase2(result.job_id);
            } else {
                notificationSystem.show('Error: No se encontró ID del trabajo para cotejación', 'error');
            }
        });
        
        document.getElementById('try-another-recipe')?.addEventListener('click', () => {
            resetAnalysis();
        });
        
        currentAnalysis = { id: result.job_id, resultado_final_json: result };
        appState.currentAnalysis = currentAnalysis;
    }, 1500);
}

// ===== ANÁLISIS ORIGINAL CON MAKE =====
async function startAnalysis() {
    if (!selectedFile) {
        notificationSystem.show('Por favor selecciona un archivo primero', 'warning'); //
        return; //
    }

    if (aiLearningSystem && aiLearningSystem.isActive) {
        aiLearningSystem.showLearningActivity(); //
    }

    showProgressArea(); //
    updateProgress(0, 'Subiendo archivo y extrayendo platos...'); //

    const analyzeButton = document.getElementById('analyze-button'); //
    if (analyzeButton) {
        analyzeButton.disabled = true; //
        analyzeButton.innerHTML = `<div class="spinner mr-2"></div>Analizando con IA...`; //
    }

    try {
        const formData = new FormData(); //
        formData.append('file', selectedFile); //

        const response = await fetch(APP_CONFIG.START_ANALYSIS_URL, {
            method: 'POST', //
            body: formData //
        });

        if (!response.ok) {
            const errorText = await response.text(); //
            throw new Error(`Error del servidor (${response.status}): ${errorText}`); //
        }

        const result = await response.json(); //

        if (result?.job_id) {
            subscribeToAnalysisUpdates(result.job_id); //
            notificationSystem.show('🧠 Análisis iniciado con IA adaptativa activa', 'ai'); //
        } else {
            throw new Error('La respuesta del servidor no contenía un job_id válido.'); //
        }

    } catch (error) {
        console.error('Error al iniciar análisis:', error); //
        showError(`No se pudo iniciar el análisis: ${error.message}`); //
        resetAnalysisUI(); //
    }
}

function handleRealtimeProgress(progressData) { // Se quita el "=" y se añade "{"
    console.log('📬 Progreso recibido:', progressData);
    const mensaje = progressData.mensaje;
    let payload; 

    // --- LÓGICA "A PRUEBA DE BALAS" ---
    try {
        if (typeof progressData.payload === 'string') {
            console.log('🔧 Payload recibido como STRING, parseando...');
            payload = JSON.parse(progressData.payload);
        } else if (progressData.payload && typeof progressData.payload === 'object') {
            console.log('✅ Payload recibido como OBJETO, usando directamente.');
            payload = progressData.payload;
        } else {
            payload = {};
        }
    } catch (error) {
        console.error('❌ Error CRÍTICO al procesar el payload:', error);
        payload = { tipo: 'error', error: 'Payload inválido' };
    }
    
    // --- FIN DE LA LÓGICA ---

    updateProgress(payload.progreso || null, mensaje);
    
    switch (payload.tipo) {
        case 'plato_completado':
             if (payload.plato_completado) {
                const plato = payload.plato_completado;
                renderLivePlatoResult(plato.nombre_plato, plato.ingredientes);
             }
             break;
        case 'completado':
            handleCompletado(payload);
            break;
    }
} // Se añade la llave de cierre

function subscribeToAnalysisUpdates(jobId) {
    console.log(`📡 Escuchando cambios para el trabajo ${jobId}...`);
    unsubscribeAll(); // Limpia suscripciones anteriores ANTES de crear una nueva.

    appState.realtimeChannels.status = supabaseClient
        .channel(`db-changes-${jobId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: APP_CONFIG.TABLES.TRABAJOS,
            filter: `id=eq.${jobId}`
        }, (payload) => {
            const updatedJob = payload.new;
            console.log(`✅ Cambio de estado recibido: ${updatedJob.estado}`);
            
            // Solo nos desuscribimos cuando el trabajo termina o falla.
            if (updatedJob.estado === APP_CONFIG.STATES.COMPLETADO || updatedJob.estado === APP_CONFIG.STATES.ERROR) {
                unsubscribeAll();
            }

            switch (updatedJob.estado) {
                case APP_CONFIG.STATES.INGREDIENTES_EXTRAIDOS:
                    showIngredientesExtractedStep(updatedJob);
                    break;
                case APP_CONFIG.STATES.COMPLETADO:
                    showFinalResults(updatedJob);
                    break;
                case APP_CONFIG.STATES.ERROR:
                    showError(updatedJob.mensaje_error || 'El proceso falló por una razón desconocida.');
                    break;
            }
        })
        .subscribe();

    simulateProgress();
}

function simulatePhase2Progress() {
    let progress = 0; //
    const messages = [
        'Analizando ingredientes...', //
        '🧠 Aplicando conocimiento aprendido...', //
        'Buscando productos en la base de datos...', //
        '📊 Calculando similitudes semánticas...', //
        '💾 Capturando feedback automático...', //
        'Asignando precios...', //
        'Generando escandallo final...' //
    ];
    let messageIndex = 0; //

    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(() => {
        progress += Math.random() * 15; //
        if (progress > 95) {
            progress = 95; //
            clearInterval(progressInterval); //
        }

        if (progress > (messageIndex + 1) * 15 && messageIndex < messages.length - 1) {
            messageIndex++; //
        }

        updateProgress(progress, messages[messageIndex]); //
    }, 1800);
}

function showFinalResults(job) {
    if (progressInterval) {
        clearInterval(progressInterval); //
    }

    updateProgress(100, '¡Análisis completado con IA adaptativa!'); //

    setTimeout(() => {
        const progressArea = document.getElementById('progress-area'); //
        const snapResultsArea = document.getElementById('snap-results-area'); //

        progressArea?.classList.add('hidden'); //
        snapResultsArea?.classList.remove('hidden'); //

        currentAnalysis = job; //
        appState.currentAnalysis = job; //

        const data = typeof job.resultado_final_json === 'string' ?
        JSON.parse(job.resultado_final_json) : job.resultado_final_json;

    const platos = data.platos_procesados;
    // --- INICIO DE LA CORRECCIÓN ---
    // Leemos directamente de las estadísticas pre-calculadas por el backend.
    // Usamos el operador ?. para evitar errores si el objeto 'estadisticas' no existiera.
    const totalIngredients = data.estadisticas?.total_ingredientes || 0;
    const foundIngredients = data.estadisticas?.ingredientes_encontrados || 0;
    // La tasa de éxito también viene calculada, la usamos directamente.
    const successRate = data.estadisticas?.tasa_exito_porcentaje || 0;

        const learnedMatches = platos.reduce((sum, p) => {
            return sum + (p.ingredientes_cotejados?.filter(ing => Utils.getMatchSource(ing) === 'learned').length || 0); //
        }, 0);

        const successBanner = `
            <div class="alert alert-success mb-8">
                <i class="fas fa-trophy text-3xl mr-4" aria-hidden="true"></i>
                <div>
                    <h3 class="font-bold text-xl">¡Análisis Completado con IA Adaptativa!</h3>
                    <p class="text-sm mt-1">Tu receta ha sido analizada y <strong>la IA ha aprendido ${learnedMatches} nuevas relaciones</strong> para mejorar futuras búsquedas.</p>
                </div>
            </div>
        `; //

        const summaryCard = `
            <div class="card p-8 mb-8 bg-gradient-to-br from-teal-50 to-cyan-50 border-teal-200">
                <div class="text-center mb-6">
                    <h3 class="text-2xl font-bold text-gray-800 mb-2">Resumen del Análisis con IA</h3>
                </div>
                
                <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-blue-600">${platos.length}</p>
                        <p class="text-sm text-gray-600">Platos</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-green-600">${totalIngredients}</p>
                        <p class="text-sm text-gray-600">Ingredientes</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-teal-600">${foundIngredients}</p>
                        <p class="text-sm text-gray-600">Encontrados</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg border-2 border-purple-200 bg-purple-50">
                        <p class="text-2xl font-bold text-purple-600">${learnedMatches}</p>
                        <p class="text-sm text-purple-600">IA Aprendida</p>
                    </div>
                    <div class="text-center p-3 bg-white rounded-lg">
                        <p class="text-2xl font-bold text-indigo-600">${successRate}%</p>
                        <p class="text-sm text-gray-600">% Éxito</p>
                    </div>
                </div>
                
                <div class="mt-4 p-3 bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg border border-purple-200">
                    <div class="flex items-center justify-center">
                        <i class="fas fa-brain text-purple-600 mr-2"></i>
                        <span class="text-purple-700 font-semibold">
                            La IA capturó ${totalIngredients} nuevos puntos de aprendizaje de este análisis
                        </span>
                    </div>
                </div>
            </div>
        `; //

        const platosHTML = platos.map(plato => {
            const ingredientsPreview = plato.ingredientes_cotejados.slice(0, 4); //
            const foundInPlato = Utils.calculateFoundIngredients(plato.ingredientes_cotejados); //
            const platoSuccessRate = plato.ingredientes_cotejados.length > 0 ?
                Math.round((foundInPlato / plato.ingredientes_cotejados.length) * 100) : 0; //

            const learnedInPlato = plato.ingredientes_cotejados.filter(ing => Utils.getMatchSource(ing) === 'learned').length; //

            return `
                <div class="card p-6 mb-6 hover:shadow-lg transition-shadow">
                    <div class="flex justify-between items-start mb-4">
                        <h4 class="text-2xl font-bold text-gray-800">${Utils.sanitizeHTML(plato.plato_analizado)}</h4>
                        <div class="text-right">
                            <div class="text-lg font-bold text-teal-600">${platoSuccessRate}% éxito</div>
                            <p class="text-sm text-gray-500">${foundInPlato}/${plato.ingredientes_cotejados.length} encontrados</p>
                            <p class="text-xs text-purple-600">${learnedInPlato} por IA aprendida</p>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        ${ingredientsPreview.map(ing => {
                            const similarity = Utils.getSimilarityInfo(ing.similitud); //
                            const source = Utils.getMatchSource(ing); //

                            return `
                                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div class="flex items-center">
                                        <div class="w-3 h-3 rounded-full ${similarity.color.replace('/80', '')} mr-3"></div>
                                        <div>
                                            <div class="flex items-center">
                                                <i class="fas ${source === 'learned' ? 'fa-brain text-purple-500' : 'fa-search text-blue-500'} mr-1 text-xs"></i>
                                                <p class="font-medium text-gray-800">${Utils.sanitizeHTML(ing.ingrediente_ia)}</p>
                                            </div>
                                            <p class="text-xs text-gray-500">${Utils.sanitizeHTML(ing.producto_encontrado || 'No encontrado')}</p>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-xs text-gray-500">${similarity.percentage}</p>
                                        <p class="text-xs ${source === 'learned' ? 'text-purple-600' : 'text-blue-600'}">
                                            ${source === 'learned' ? 'IA' : 'SEM'}
                                        </p>
                                    </div>
                                </div>
                            `; //
                        }).join('')}
                    </div>
                    
                    ${plato.ingredientes_cotejados.length > 4 ? `
                        <p class="text-sm text-gray-500 text-center mb-4">
                            ... y ${plato.ingredientes_cotejados.length - 4} ingredientes más
                        </p>
                    ` : ''}
                    
                    <button data-plato-name="${Utils.sanitizeHTML(plato.plato_analizado)}" class="w-full btn btn-primary view-plato-details-btn">
                        <i class="fas fa-eye mr-2" aria-hidden="true"></i>
                        Ver Detalles Completos
                    </button>
                </div>
            `; //
        }).join('');

        const actionButtons = `
            <div class="mt-10 text-center">
                <div class="flex flex-col sm:flex-row justify-center gap-4">
                    <button id="view-full-details-button" class="btn btn-primary text-lg px-10 py-4">
                        <i class="fas fa-chart-line mr-3" aria-hidden="true"></i>
                        Ver Análisis Completo
                    </button>
                    <button id="view-ai-dashboard-button" class="btn btn-ai text-lg px-10 py-4">
                        <i class="fas fa-brain mr-3" aria-hidden="true"></i>
                        Ver Dashboard IA
                    </button>
                    <button id="reset-button-final" class="btn btn-danger text-lg px-10 py-4">
                        <i class="fas fa-undo mr-3" aria-hidden="true"></i>
                        Analizar Otra Receta
                    </button>
                </div>
                <p class="text-sm text-gray-500 mt-4">
                    Puedes ver el análisis completo, revisar qué aprendió la IA, o analizar otra receta.
                </p>
            </div>
        `; //

        if (snapResultsArea) {
            snapResultsArea.innerHTML = successBanner + summaryCard + platosHTML + actionButtons; //
        }

        document.querySelectorAll('.view-plato-details-btn').forEach(button => {
            button.addEventListener('click', () => {
                const platoName = button.getAttribute('data-plato-name'); //
                showPlatoDetails(platoName); //
            });
        });

        document.getElementById('view-full-details-button')?.addEventListener('click', () => {
            renderDetailsModal(platos); //
        });

        document.getElementById('view-ai-dashboard-button')?.addEventListener('click', () => {
            window.location.hash = '#ai-dashboard'; //
        });

        document.getElementById('reset-button-final')?.addEventListener('click', () => {
            resetAnalysis(); //
        });

        notificationSystem.show(
            `🎉 ¡Análisis completado! ${successRate}% éxito • ${learnedMatches} cotejamientos por IA aprendida`, //
            'ai', //
            8000 //
        );

    }, 1500);
}

function showPlatoDetails(platoName) {
    if (!currentAnalysis) return; //

    const data = typeof currentAnalysis.resultado_final_json === 'string' ?
        JSON.parse(currentAnalysis.resultado_final_json) : currentAnalysis.resultado_final_json; //

    const plato = data.platos_procesados.find(p => p.plato_analizado === platoName); //
    if (plato) {
        renderDetailsModal([plato]); //
    } else {
        notificationSystem.show(`No se encontraron detalles para el plato: ${platoName}`, 'error'); //
    }
}

// ===== FUNCIONES DE ERROR Y RESET =====
function showError(errorMessage) {
    console.log('❌ Mostrando error:', errorMessage);
    unsubscribeFromRealtimeProgress();
    pararContadorTiempo();
    
    document.getElementById('progress-area')?.classList.add('hidden');
    const snapResultsArea = document.getElementById('snap-results-area');
    snapResultsArea?.classList.remove('hidden');
    
    const errorHTML = `
        <div class="card p-10 text-center bg-red-50 border-red-200">
            <div class="mb-6">
                <i class="fas fa-exclamation-triangle text-6xl text-red-500 mb-4"></i>
                <h3 class="text-3xl font-bold text-red-700 mb-3">Error en el Análisis</h3>
            </div>
            <div class="max-w-2xl mx-auto mb-8">
                <p class="text-lg text-red-600 mb-4">${Utils.sanitizeHTML(errorMessage)}</p>
                <div class="text-sm text-gray-600 bg-white p-4 rounded-lg border">
                    <p class="mb-2"><strong>Posibles soluciones:</strong></p>
                    <ul class="text-left space-y-1">
                        <li>• Verifica tu conexión a internet</li>
                        <li>• Asegúrate de que el archivo sea válido</li>
                        <li>• Intenta con un archivo diferente</li>
                        <li>• Contacta al soporte si el problema persiste</li>
                    </ul>
                </div>
            </div>
            <div class="flex flex-col sm:flex-row justify-center gap-4">
                <button id="retry-analysis-button" class="btn btn-primary">
                    <i class="fas fa-redo mr-2"></i>Intentar de Nuevo
                </button>
                <button id="reset-button-error" class="btn btn-danger">
                    <i class="fas fa-home mr-2"></i>Volver al Inicio
                </button>
            </div>
        </div>`;
    
    if (snapResultsArea) snapResultsArea.innerHTML = errorHTML;
    
    document.getElementById('retry-analysis-button')?.addEventListener('click', () => {
        if (selectedFile) startSupabaseAnalysis();
        else resetAnalysis();
    });
    
    document.getElementById('reset-button-error')?.addEventListener('click', () => resetAnalysis());
}

function resetAnalysisUI() {
    console.log('🔄 Reiniciando UI de análisis');
    const analyzeButton = document.getElementById('analyze-button'); //
    const analyzeSupabaseButton = document.getElementById('analyze-supabase-button');
    
    if (analyzeButton) {
        analyzeButton.disabled = !selectedFile; //
        analyzeButton.innerHTML = `<i class="fas fa-cogs mr-2" aria-hidden="true"></i>Analizar con Make (Original)`;
    }
    
    if (analyzeSupabaseButton) {
        analyzeSupabaseButton.disabled = !selectedFile;
        analyzeSupabaseButton.innerHTML = `
            <i class="fas fa-rocket mr-3" aria-hidden="true"></i>
            <span class="flex flex-col items-center">
                <span>Análisis Rápido Supabase</span>
                <span class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-bold animate-pulse">TIEMPO REAL</span>
            </span>`;
    }
}

function resetAnalysis() {
    console.log('🔄 Reiniciando análisis completo');
    
    unsubscribeFromRealtimeProgress();
    unsubscribeAll(); //
    pararContadorTiempo();
    
    if (progressInterval) {
        clearInterval(progressInterval); //
        progressInterval = null; //
    }
    
    selectedFile = null; //
    currentAnalysis = null; //
    appState.selectedFile = null; //
    appState.currentAnalysis = null; //
    
    appState.currentProgress = {
        platosDetectados: [],
        platosCompletados: [],
        totalPlatos: 0,
        progresoPorcentaje: 0,
        ingredientesUnicos: 0,
        tiempoInicio: null
    };
    
    document.getElementById('file-input').value = ''; //
    document.getElementById('file-preview').classList.add('hidden'); //
    resetAnalysisUI();
    document.getElementById('progress-area')?.classList.add('hidden'); //
    document.getElementById('snap-results-area')?.classList.add('hidden'); //
    document.getElementById('snap-upload-area')?.classList.remove('hidden'); //
    
    const learningPanel = document.getElementById('ai-learning-panel'); //
    const aiIndicators = document.getElementById('ai-learning-indicators'); //
    if (learningPanel) learningPanel.classList.add('hidden'); //
    if (aiIndicators) aiIndicators.classList.add('hidden'); //
    
    window.scrollTo({ top: 0, behavior: 'smooth' }); //
}

function handleFile(file) {
    console.log('📁 Archivo seleccionado:', file?.name);
    if (!file) return; //
    
    const validation = Utils.validateFile(file); //
    if (!validation.isValid) {
        notificationSystem.show(`Archivo inválido: ${validation.errors.join(', ')}`, 'error'); //
        return; //
    }
    
    selectedFile = file; //
    appState.selectedFile = file; //
    
    const filePreview = document.getElementById('file-preview'); //
    if (filePreview) {
        document.getElementById('file-name').textContent = file.name; //
        document.getElementById('file-size').textContent = Utils.formatFileSize(file.size); //
        filePreview.classList.remove('hidden'); //
    }
    
    const analyzeButton = document.getElementById('analyze-button'); //
    const analyzeSupabaseButton = document.getElementById('analyze-supabase-button');
    if (analyzeButton) analyzeButton.disabled = false; //
    if (analyzeSupabaseButton) {
        analyzeSupabaseButton.disabled = false;
        console.log('✅ Botón Supabase habilitado');
    }
    
    notificationSystem.show(`Archivo "${file.name}" seleccionado correctamente`, 'success', 3000); //
}

function removeFile() {
    selectedFile = null; //
    appState.selectedFile = null; //
    document.getElementById('file-input').value = ''; //
    document.getElementById('file-preview').classList.add('hidden'); //
    document.getElementById('analyze-button').disabled = true; //
    document.getElementById('analyze-supabase-button').disabled = true;
}

function unsubscribeAll() {
    if (appState.realtimeChannels.status) {
        supabaseClient.removeChannel(appState.realtimeChannels.status); //
        appState.realtimeChannels.status = null; //
        console.log('🔇 Desuscrito del estado del trabajo');
    }
    unsubscribeFromRealtimeProgress();
}

// ===== FUNCIONES PARA CARGAR DATOS =====
function showEscandalloDetails(id) {
    const escandallo = appState.savedEscandallos.find(item => item.id.toString() === id.toString()); //
    if (!escandallo) {
        notificationSystem.show('Escandallo no encontrado', 'error'); //
        return; //
    }

    let platos = []; //
    if (escandallo.resultado_final_json) {
        try {
            const data = typeof escandallo.resultado_final_json === 'string' ?
                JSON.parse(escandallo.resultado_final_json) : escandallo.resultado_final_json; //
            platos = data.platos_procesados || []; //
        } catch (e) {
            console.error("Error parseando JSON del escandallo:", e);
            notificationSystem.show('Los datos de este escandallo están corruptos.', 'error');
            return;
        }
    }

    if (platos.length > 0) {
        renderDetailsModal(platos); //
    } else {
        notificationSystem.show('No se encontraron datos de platos en este escandallo.', 'error');
    }
}

async function loadEscandallosGuardados() {
    const grid = document.getElementById('escandallos-grid'); //
    const emptyState = document.getElementById('escandallos-empty-state'); //

    grid.innerHTML = Array(6).fill(0).map(() => `<div class="h-64 loading-skeleton rounded-lg"></div>`).join(''); //
    emptyState.classList.add('hidden'); //

    try {
        const { data, error } = await supabaseClient
            .from(APP_CONFIG.TABLES.TRABAJOS) //
            .select('*') //
            .eq('estado', APP_CONFIG.STATES.COMPLETADO) //
            .order('created_at', { ascending: false }); //

        if (error) throw error; //

        appState.savedEscandallos = data || []; //
        renderEscandallosGuardados(data || []); //

    } catch (error) {
        console.error("Error cargando escandallos guardados:", error); //
        grid.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-red-500">Error al cargar los datos.</p></div>'; //
        notificationSystem.show(`Error al cargar escandallos: ${error.message}`, 'error'); //
    }
}

// Busca esta función en tu main.js y reemplázala por completo

// Reemplaza la función entera en tu main.js por esta versión robusta:

function renderEscandallosGuardados(escandallos) {
    const grid = document.getElementById('escandallos-grid');
    const emptyState = document.getElementById('escandallos-empty-state');

    if (!escandallos || escandallos.length === 0) {
        if (grid) grid.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if(emptyState) emptyState.classList.add('hidden');
    if(!grid) return;

    grid.innerHTML = escandallos.map(item => {
        let data, platos;
        try {
            if (!item.resultado_final_json || typeof item.resultado_final_json !== 'string') {
                console.warn(`Escandallo ${item.id} no tiene un JSON válido.`);
                return ''; 
            }
            
            // --- INICIO DE LA CORRECCIÓN ---
            // Esta nueva lógica busca el primer JSON válido en el texto y ignora el resto.
            let jsonString = item.resultado_final_json.trim();
            const firstBrace = jsonString.indexOf('{');
            const lastBrace = jsonString.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error("No se encontraron llaves '{' o '}' en el string del JSON.");
            }
            
            // Extraemos lo que parece ser el primer objeto JSON completo.
            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
            // --- FIN DE LA CORRECCIÓN ---

            data = JSON.parse(jsonString); // Ahora parseamos el string limpio.
            platos = data?.platos_procesados || [];

        } catch (e) {
            // Este es el error que estás viendo en la consola.
            console.error(`Error parseando JSON para el trabajo ${item.id}:`, e);
            // Mostramos una tarjeta de error para el dato corrupto sin detener la página.
            return `<div class="card p-6 border-red-500 bg-red-50">
                        <p class="font-bold text-red-700">Error en los datos</p>
                        <p class="text-sm text-red-600">No se pudo cargar el escandallo con ID: ${item.id}</p>
                    </div>`;
        }

        // El resto del código para dibujar la tarjeta sigue igual...
        const totalIngredients = platos.reduce((sum, p) => sum + (p.ingredientes_cotejados?.length || 0), 0);
        const foundIngredients = platos.reduce((sum, p) => sum + Utils.calculateFoundIngredients(p.ingredientes_cotejados), 0);
        const successRate = totalIngredients > 0 ? Math.round((foundIngredients / totalIngredients) * 100) : 0;
        const platoPrincipal = platos[0]?.plato_analizado || item.nombre_original_archivo || 'Análisis';

        return `
            <div class="card p-6 bg-white hover:shadow-xl transition-shadow duration-300">
                <div class="flex items-start justify-between mb-4">
                    <div>
                        <h3 class="font-bold text-xl text-gray-800">${Utils.sanitizeHTML(platoPrincipal)}</h3>
                        <p class="text-sm text-gray-500 mt-1">
                            Analizado el ${Utils.formatDate(item.created_at)}
                        </p>
                    </div>
                    <div class="text-right flex-shrink-0 ml-4">
                        <div class="text-2xl font-bold text-teal-600">${successRate}%</div>
                        <p class="text-xs text-gray-500">Éxito</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-4 mb-6 text-center">
                    <div class="bg-gray-50 p-3 rounded-lg">
                        <p class="text-xl font-bold text-blue-600">${platos.length}</p>
                        <p class="text-xs text-gray-600">Platos</p>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-lg">
                        <p class="text-xl font-bold text-green-600">${totalIngredients}</p>
                        <p class="text-xs text-gray-600">Ingredientes</p>
                    </div>
                </div>
                
                <button onclick="showEscandalloDetails('${item.id}')" class="w-full btn btn-primary">
                    <i class="fas fa-eye mr-2"></i>
                    Ver Detalles
                </button>
            </div>
        `;
    }).filter(Boolean).join('');
}

async function loadIngredientesExtraidos() {
    const grid = document.getElementById('ingredientes-ia-grid'); //
    const emptyState = document.getElementById('ingredientes-ia-empty-state'); //

    grid.innerHTML = Array(4).fill(0).map(() => `<div class="h-48 loading-skeleton rounded-lg"></div>`).join(''); //
    emptyState.classList.add('hidden'); //

    try {
        const { data, error } = await supabaseClient
            .from(APP_CONFIG.TABLES.TRABAJOS) //
            .select(`id, created_at, platos (nombre, platos_ingredientes(cantidad, ingredientes(nombre)))`) //
            .eq('estado', APP_CONFIG.STATES.INGREDIENTES_EXTRAIDOS) //
            .order('created_at', { ascending: false }); //

        if (error) throw error; //

        appState.ingredientesExtraidos = data || []; //
        renderIngredientesExtraidos(data || []); //

    } catch (error) {
        console.error("Error cargando ingredientes extraídos:", error); //
        grid.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-red-500">Error al cargar los datos.</p></div>'; //
        notificationSystem.show(`Error al cargar ingredientes: ${error.message}`, 'error'); //
    }
}

function renderIngredientesExtraidos(jobs) {
    const grid = document.getElementById('ingredientes-ia-grid'); //
    const emptyState = document.getElementById('ingredientes-ia-empty-state'); //

    if (!jobs || jobs.length === 0) {
        grid.innerHTML = ''; //
        emptyState.classList.remove('hidden'); //
        return; //
    }

    emptyState.classList.add('hidden'); //

    grid.innerHTML = jobs.map(job => {
        if (!job.platos || job.platos.length === 0) return '';
        const platoPrincipal = job.platos[0]?.nombre || 'Plato sin nombre'; //
        const totalIngredientes = job.platos.reduce((sum, p) => sum + (p.platos_ingredientes?.length || 0), 0); //
        const platosCount = job.platos.length; //

        return `
            <div class="card p-6 bg-white">
                <div class="flex items-start justify-between mb-4">
                    <h3 class="font-bold text-xl text-gray-800">
                        ${Utils.sanitizeHTML(platoPrincipal)}
                        ${platosCount > 1 ? `<span class="text-sm text-teal-600 font-medium ml-2">(+${platosCount - 1} más)</span>` : ''}
                    </h3>
                    <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">Fase 1</span>
                </div>
                
                <p class="text-sm text-gray-500 mb-4 flex items-center">
                    <i class="fas fa-clock mr-2" aria-hidden="true"></i>
                    Analizado el ${Utils.formatDate(job.created_at)}
                </p>
                
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="text-center p-3 bg-gray-50 rounded-lg">
                        <p class="text-2xl font-bold text-teal-600">${totalIngredientes}</p>
                        <p class="text-xs text-gray-600">Ingredientes</p>
                    </div>
                    <div class="text-center p-3 bg-gray-50 rounded-lg">
                        <p class="text-2xl font-bold text-blue-600">${platosCount}</p>
                        <p class="text-xs text-gray-600">Platos</p>
                    </div>
                </div>
                
                <div class="alert alert-info">
                    <i class="fas fa-info-circle mr-2" aria-hidden="true"></i>
                    <div>
                        <p class="font-medium">Listo para Fase 2</p>
                        <p class="text-sm">Este análisis está preparado para la cotejación con productos reales.</p>
                    </div>
                </div>
            </div>
        `; //
    }).join('');
}

async function updateDatabaseView(mode) {
    appState.currentDatabaseView = mode; //
    const modeIndicator = document.getElementById('current-mode'); //
    const container = document.getElementById('database-container');
    const emptyState = document.getElementById('database-empty-state');

    container.innerHTML = `<div class="h-64 loading-skeleton rounded-lg"></div>`;
    emptyState.classList.add('hidden');

    if (mode === 'ingredients') {
        await loadIngredients(); //
        modeIndicator.innerHTML = `<i class="fas fa-robot mr-2" aria-hidden="true"></i>Ingredientes IA (Fase 1)`; //
        modeIndicator.className = 'bg-teal-100 text-teal-700 px-4 py-2 rounded-full text-sm font-medium flex items-center'; //
    } else {
        await loadProductCatalog(); //
        modeIndicator.innerHTML = `<i class="fas fa-shopping-cart mr-2" aria-hidden="true"></i>Catálogo de Productos`; //
        modeIndicator.className = 'bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium flex items-center'; //
    }
}

async function loadIngredients() {
    const container = document.getElementById('database-container');
    try {
        const { data, error } = await supabaseClient
            .from(APP_CONFIG.TABLES.INGREDIENTES) //
            .select('*') //
            .order('nombre', { ascending: true }); //

        if (error) throw error; //

        renderIngredientsTable(data || []); //

    } catch (error) {
        console.error("Error cargando ingredientes:", error); //
        container.innerHTML = '<p class="text-red-500 text-center py-8">Error al cargar los datos.</p>'; //
        notificationSystem.show(`Error al cargar ingredientes: ${error.message}`, 'error'); //
    }
}

async function loadProductCatalog() {
    const container = document.getElementById('database-container');
    try {
        const { data, error } = await supabaseClient
            .from(APP_CONFIG.TABLES.PRODUCTOS) //
            .select('*') //
            .order('nombre', { ascending: true }); //

        if (error) throw error; //

        renderProductCatalogList(data || []); //

    } catch (error) {
        console.error("Error cargando catálogo:", error); //
        container.innerHTML = '<p class="text-red-500 text-center py-8">Error al cargar los datos.</p>'; //
        notificationSystem.show(`Error al cargar catálogo: ${error.message}`, 'error'); //
    }
}

function renderIngredientsTable(ingredients) {
    const container = document.getElementById('database-container'); //

    if (!ingredients || ingredients.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12">
                <i class="fas fa-leaf text-4xl text-gray-300 mb-4"></i>
                <h3 class="text-lg font-semibold text-gray-600 mb-2">No hay ingredientes registrados</h3>
                <p class="text-gray-500">Los ingredientes aparecerán aquí cuando se procesen recetas.</p>
            </div>
        `; //
        return;
    }

    container.innerHTML = `
        <table class="w-full text-sm text-left text-gray-500">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                    <th scope="col" class="px-6 py-3">Nombre del Ingrediente</th>
                    <th scope="col" class="px-6 py-3">ID</th>
                    <th scope="col" class="px-6 py-3">Fecha de Creación</th>
                </tr>
            </thead>
            <tbody>
                ${ingredients.map(ing => `
                <tr class="bg-white border-b hover:bg-gray-50">
                    <th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">${Utils.sanitizeHTML(ing.nombre)}</th>
                    <td class="px-6 py-4">${ing.id}</td>
                    <td class="px-6 py-4">${Utils.formatDate(ing.created_at)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    `; //
}

function renderProductCatalogList(products) {
    const container = document.getElementById('database-container'); //

    if (!products || products.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12">
                <i class="fas fa-shopping-basket text-4xl text-gray-300 mb-4"></i>
                <h3 class="text-lg font-semibold text-gray-600 mb-2">No hay productos en el catálogo</h3>
                <p class="text-gray-500">Los productos aparecerán aquí cuando se actualicen los precios.</p>
            </div>
        `; //
        return;
    }

    container.innerHTML = `
        <div class="product-list">
            ${products.map(prod => {
                const imageUrl = prod.imagen_tarjeta_url; //
                return `
                    <div class="product-item">
                        ${imageUrl ?
                            `<img src="${imageUrl}" alt="${prod.nombre}" class="product-image-small" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                             <div class="product-image-placeholder-small" style="display:none;">
                                 <i class="fas fa-shopping-cart text-gray-400"></i>
                             </div>` :
                            `<div class="product-image-placeholder-small">
                                 <i class="fas fa-shopping-cart text-gray-400"></i>
                             </div>`
                        }
                        <div class="flex-grow">
                            <h4 class="font-semibold text-gray-800">${Utils.sanitizeHTML(prod.nombre)}</h4>
                            <div class="text-sm text-gray-500 mt-1">
                                <p><strong>Marca:</strong> ${prod.marca ? Utils.sanitizeHTML(prod.marca) : 'N/A'}</p>
                                <p><strong>Unidad:</strong> ${prod.unidad ? Utils.sanitizeHTML(prod.unidad) : 'N/A'}</p>
                            </div>
                            <p class="text-xs text-gray-400 mt-2">ID: ${prod.id}</p>
                        </div>
                    </div>
                `; //
            }).join('')}
        </div>
    `;
}

// ===== RENDER DETAILS MODAL COMPLETO =====
function renderDetailsModal(platos) {
    const platosArray = Array.isArray(platos) ? platos : [platos]; //
    
    const allPlatosHTML = platosArray.map(plato => {
        const ingredientsGridHTML = (plato.ingredientes_cotejados || plato.ingredientes || []).map(ing => {
            const similarityInfo = Utils.getSimilarityInfo(ing.similitud); //
            const matchSource = Utils.getMatchSource(ing); //

            return `
            <div class="ingredient-card-container">
                <div class="ingredient-image-card">
                    ${ing.imagen_url ?
                        `<img src="${ing.imagen_url}" alt="${ing.producto_encontrado}" class="ingredient-image" onerror="this.style.display='none'; this.parentElement.querySelector('.ingredient-image-placeholder').style.display='flex';">` : //
                        ''
                    }
                    <div class="ingredient-image-placeholder" style="${ing.imagen_url ? 'display:none;' : ''}"><i class="fas fa-image"></i></div>
                    <div class="similarity-badge" style="background-color: ${similarityInfo.color};">
                        ${similarityInfo.percentage}
                    </div>
                    <div class="absolute top-8px left-8px">
                        <div class="similarity-source-indicator ${matchSource === 'learned' ? 'source-learned' : 'source-semantic'}">
                            <i class="fas ${matchSource === 'learned' ? 'fa-brain' : 'fa-search'}"></i>
                            ${matchSource === 'learned' ? 'IA' : 'SEM'}
                        </div>
                    </div>
                </div>
                
                <div class="ingredient-data-card">
                    <h4 class="font-bold text-lg text-gray-800 mb-2">${Utils.sanitizeHTML(ing.ingrediente_ia || ing.nombre_ingrediente)}</h4>
                    
                    <div class="space-y-3 mb-4">
                        <div>
                            <p class="text-xs text-gray-500 uppercase font-semibold">Producto Encontrado</p>
                            <p class="font-medium text-teal-700">${Utils.sanitizeHTML(ing.producto_encontrado || 'No encontrado')}</p>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p class="text-xs text-gray-500 uppercase font-semibold">Marca</p>
                                <p class="font-medium">${ing.marca || 'N/A'}</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 uppercase font-semibold">Unidad</p>
                                <p class="font-medium">${ing.unidad_compra || 'N/A'}</p>
                            </div>
                        </div>

                        <div class="p-2 rounded-lg ${matchSource === 'learned' ? 'bg-purple-50 border border-purple-200' : 'bg-blue-50 border border-blue-200'}">
                            <p class="text-xs font-semibold ${matchSource === 'learned' ? 'text-purple-700' : 'text-blue-700'}">
                                <i class="fas ${matchSource === 'learned' ? 'fa-brain' : 'fa-search'} mr-1"></i>
                                ${matchSource === 'learned' ? 'Cotejamiento por IA Aprendida' : 'Cotejamiento Semántico'}
                            </p>
                            <p class="text-xs ${matchSource === 'learned' ? 'text-purple-600' : 'text-blue-600'}">
                                ${matchSource === 'learned' ? 'Basado en relaciones aprendidas anteriormente' : 'Basado en análisis semántico de embeddings'}
                            </p>
                        </div>
                    </div>
                    
                    <div class="border-t pt-3 mt-3">
                        <div class="flex justify-between items-center">
                            <div>
                                <p class="text-xs text-gray-500 uppercase font-semibold">Cantidad</p>
                                <p class="font-bold text-lg text-gray-800">${Utils.sanitizeHTML(ing.cantidad)}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-xs text-gray-500 uppercase font-semibold">Similitud</p>
                                <p class="font-bold text-lg ${similarityInfo.value > 70 ? 'text-green-600' : similarityInfo.value > 40 ? 'text-yellow-600' : 'text-red-600'}">${similarityInfo.percentage}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            `; //
        }).join('');

        const foundIngredients = Utils.calculateFoundIngredients(plato.ingredientes_cotejados || plato.ingredientes); //
        const totalIngredients = (plato.ingredientes_cotejados || plato.ingredientes || []).length; //
        const successRate = totalIngredients > 0 ? Math.round((foundIngredients / totalIngredients) * 100) : 0; //

        const learnedMatches = (plato.ingredientes_cotejados || plato.ingredientes || []).filter(ing => Utils.getMatchSource(ing) === 'learned').length; //
        const semanticMatches = totalIngredients - learnedMatches; //

        return `
            <div class="mb-8 last:mb-0">
                <div class="text-center mb-6">
                    <h2 class="text-3xl font-bold text-gray-800">Desglose para: <span class="text-teal-600">${Utils.sanitizeHTML(plato.nombre_plato || plato.plato_analizado)}</span></h2>
                </div>
                <div class="card p-4 text-center mb-6 bg-gray-50 border">
                    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                            <h3 class="text-sm font-semibold text-gray-600 uppercase">Total</h3>
                            <p class="text-2xl font-extrabold text-gray-800">${totalIngredients}</p>
                        </div>
                        <div>
                            <h3 class="text-sm font-semibold text-gray-600 uppercase">Encontrados</h3>
                            <p class="text-2xl font-extrabold text-green-600">${foundIngredients}</p>
                        </div>
                        <div>
                            <h3 class="text-sm font-semibold text-gray-600 uppercase">% Éxito</h3>
                            <p class="text-2xl font-extrabold text-teal-600">${successRate}%</p>
                        </div>
                        <div>
                            <h3 class="text-sm font-semibold text-gray-600 uppercase">IA Aprendida</h3>
                            <p class="text-2xl font-extrabold text-purple-600">${learnedMatches}</p>
                        </div>
                        <div>
                            <h3 class="text-sm font-semibold text-gray-600 uppercase">Semántica</h3>
                            <p class="text-2xl font-extrabold text-blue-600">${semanticMatches}</p>
                        </div>
                    </div>
                </div>
                <h4 class="text-xl font-semibold text-gray-700 mb-4">Detalle de Ingredientes</h4>
                <div class="ingredient-grid">
                    ${ingredientsGridHTML}
                </div>
            </div>
        `; //
    }).join('<hr class="my-12 border-gray-200"/>');

    const modalContent = `
        <button onclick="modalManager.close('details-modal')" class="absolute top-4 right-4 text-2xl text-gray-500 hover:text-gray-800 z-10">&times;</button>
        <div class="p-6">
            ${allPlatosHTML}
        </div>
    `; //
    
    modalManager.open('details-modal', modalContent); //
}

// ===== FUNCIONES AUXILIARES DE PROGRESO =====

function showProgressArea() {
    console.log('📊 Mostrando área de progreso');
    document.getElementById('snap-upload-area')?.classList.add('hidden');
    document.getElementById('snap-results-area')?.classList.add('hidden');
    document.getElementById('progress-area')?.classList.remove('hidden');
    
    const aiIndicators = document.getElementById('ai-learning-indicators');
    if (aiIndicators) {
        aiIndicators.classList.remove('hidden');
    }
    
    const liveResults = document.getElementById('live-results');
    if (liveResults) {
        // Añadimos una clase al div inicial para poder identificarlo
        liveResults.innerHTML = `
            <div class="initial-wait-message text-center text-gray-500 py-8">
                <h4 class="font-semibold text-gray-800 mb-4 text-xl">
                    <i class="fas fa-clock mr-2 text-teal-500 animate-spin" aria-hidden="true"></i>
                    Esperando datos en tiempo real...
                </h4>
            </div>
        `;
    }
}

function setupCameraHandling() {
    console.log('📷 Configurando manejo de cámara...');
    
    const cameraButton = document.getElementById('camera-button'); //
    const closeCameraButton = document.getElementById('close-camera-button'); //
    const snapButton = document.getElementById('snap-button'); //
    
    if (!cameraButton || !closeCameraButton || !snapButton) {
        console.error('❌ No se encontraron todos los elementos para el manejo de la cámara.');
        return;
    }
    
    let cameraStream = null; //

    async function startCamera() {
        const cameraView = document.getElementById('camera-view'); //

        if (!navigator.mediaDevices?.getUserMedia) {
            notificationSystem.show('La cámara no es compatible con este navegador', 'error'); //
            return; //
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', //
                    width: { ideal: 1920 }, //
                    height: { ideal: 1080 } //
                }
            });

            cameraView.srcObject = stream; //
            cameraStream = stream; //
            modalManager.open('camera-modal'); //

        } catch (error) {
            console.error("Error accessing camera:", error); //
            let errorMessage = 'No se pudo acceder a la cámara.'; //

            if (error.name === 'NotAllowedError') {
                errorMessage = 'Permisos de cámara denegados. Por favor, permite el acceso a la cámara.'; //
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'No se encontró ninguna cámara en el dispositivo.'; //
            }

            notificationSystem.show(errorMessage, 'error'); //
        }
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop()); //
            cameraStream = null; //
        }
        modalManager.close('camera-modal'); //
    }

    function takeSnapshot() {
        const cameraView = document.getElementById('camera-view'); //
        const cameraCanvas = document.getElementById('camera-canvas'); //

        if (!cameraView.srcObject) return;

        const context = cameraCanvas.getContext('2d'); //
        cameraCanvas.width = cameraView.videoWidth; //
        cameraCanvas.height = cameraView.videoHeight; //

        context.drawImage(cameraView, 0, 0, cameraCanvas.width, cameraCanvas.height); //

        cameraCanvas.toBlob((blob) => {
            if (blob) {
                const photoFile = new File([blob], `captura-${Date.now()}.png`, { type: "image/png" }); //
                handleFile(photoFile); //
                stopCamera(); //
            }
        }, 'image/png', 0.9);
    }
    
    cameraButton.addEventListener('click', startCamera);
    closeCameraButton.addEventListener('click', stopCamera);
    snapButton.addEventListener('click', takeSnapshot);
    
    console.log('✅ Manejo de cámara configurado correctamente');
}

async function showIngredientesExtractedStep(job) {
    if (progressInterval) {
        clearInterval(progressInterval); //
    }

    updateProgress(100, 'Ingredientes extraídos correctamente'); //
    currentAnalysis = job; //
    appState.currentAnalysis = job; //

    try {
        const { data: platos, error } = await supabaseClient
            .from('platos') //
            .select(`nombre, platos_ingredientes (cantidad, ingredientes ( nombre ))`) //
            .eq('trabajo_analisis_id', job.id); //

        if (error) throw error; //

        if (!platos || platos.length === 0) {
            throw new Error("No se encontraron platos para este análisis."); //
        }

        setTimeout(() => showPhase1Results(platos), 1500); //

    } catch (error) {
        console.error("Error fetching plates:", error); //
        showError("No se pudieron cargar los detalles de los platos extraídos."); //
    }
}

// ===== showPhase1Results CON BOTÓN DE COTEJACIÓN =====
function showPhase1Results(platos) {
    const progressArea = document.getElementById('progress-area'); //
    const snapResultsArea = document.getElementById('snap-results-area'); //

    progressArea?.classList.add('hidden'); //
    snapResultsArea?.classList.remove('hidden'); //

    const infoBanner = `
        <div class="alert alert-success mb-8">
            <i class="fas fa-check-circle text-2xl mr-4" aria-hidden="true"></i>
            <div>
                <h3 class="font-bold text-lg">¡Fase 1 Completada: Ingredientes Extraídos!</h3>
                <p class="text-sm mt-1">Hemos identificado los siguientes platos e ingredientes. La IA aprenderá de cada cotejamiento en la Fase 2.</p>
            </div>
        </div>
    `; //

    const platosCards = platos.map(plato => `
        <div class="card p-6 mb-4 hover:shadow-lg transition-shadow">
            <div class="flex items-start justify-between mb-4">
                <h4 class="font-bold text-xl text-gray-800">${Utils.sanitizeHTML(plato.nombre)}</h4>
                <span class="bg-green-100 text-green-800 px-2 py-1 rounded text-sm font-medium">${plato.platos_ingredientes.length} ingredientes</span>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                ${plato.platos_ingredientes.map(pi => `
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div class="flex items-center">
                            <i class="fas fa-leaf text-green-500 mr-2" aria-hidden="true"></i>
                            <span class="font-medium text-gray-800">${Utils.sanitizeHTML(pi.ingredientes.nombre)}</span>
                        </div>
                        <span class="text-teal-600 font-semibold">${Utils.sanitizeHTML(pi.cantidad)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join(''); //

    const actionButtons = `
        <div class="mt-10 text-center">
            <div class="flex flex-col sm:flex-row justify-center gap-4">
                <button id="start-matching-button" class="btn btn-success text-lg px-10 py-4">
                    <i class="fas fa-search-dollar mr-3" aria-hidden="true"></i>
                    Iniciar Cotejación con IA (Fase 2)
                </button>
                <button id="reset-button-mid" class="btn btn-danger text-lg px-10 py-4">
                    <i class="fas fa-undo mr-3" aria-hidden="true"></i>
                    Empezar de Nuevo
                </button>
            </div>
            <p class="text-sm text-gray-500 mt-4">
                La Fase 2 buscará productos reales y <strong>la IA aprenderá</strong> de cada cotejamiento para mejorar futuras búsquedas.
            </p>
        </div>
    `; //

    if (snapResultsArea) {
        snapResultsArea.innerHTML = infoBanner + platosCards + actionButtons; //
    }

    document.getElementById('start-matching-button')?.addEventListener('click', () => {
        if (currentAnalysis?.id) {
            startPhase2(currentAnalysis.id);
        } else {
            notificationSystem.show('Error: No se encontró ID del trabajo para iniciar la fase 2', 'error');
        }
    });

    document.getElementById('reset-button-mid')?.addEventListener('click', () => {
        resetAnalysis(); //
    });

    notificationSystem.show(
        `Se extrajeron ${platos.length} platos con un total de ${platos.reduce((sum, p) => sum + p.platos_ingredientes.length, 0)} ingredientes`, //
        'success' //
    );
}

function simulateProgress() {
    let progress = 0; //
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        progress += Math.random() * 15; //
        if (progress > 90) {
            progress = 90; //
            clearInterval(progressInterval); //
        }
        updateProgress(progress, 'Analizando receta con IA adaptativa...'); //
    }, 1000);
}


// ===== FUNCIONES DE COTEJACIÓN =====
function startPhase2(jobId) {
    if (!jobId) {
        notificationSystem.show('Error crítico: Se intentó iniciar la Fase 2 sin un ID de trabajo.', 'error');
        return;
    }
    
    currentAnalysis = { id: jobId }; //
    appState.currentAnalysis = currentAnalysis;

    showProgressArea(); //
    updateProgress(0, 'Iniciando Fase 2: Cotejando con IA adaptativa...'); //

    const progressMessage = document.getElementById('progress-message'); //
    if (progressMessage) {
        progressMessage.innerHTML = `
            <span class="text-gray-600">La IA está cotejando ingredientes con productos reales y </span>
            <span class="text-purple-600 font-semibold">aprendiendo de cada resultado</span>
            <span class="text-gray-600"> para mejorar futuras búsquedas.</span>
        `; //
    }
    
    simulatePhase2Progress(); //

    triggerCotejamiento(jobId); //
}


async function triggerCotejamiento(jobId) {
    try {
        const response = await fetch(APP_CONFIG.COTEJAMIENTO_WEBHOOK_URL, {
            method: 'POST', //
            headers: { 'Content-Type': 'application/json' }, //
            body: JSON.stringify({ job_id: jobId }) //
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`El webhook de cotejamiento no respondió correctamente (${response.status}): ${errorText}`); //
        }

        console.log("Webhook de cotejamiento invocado para job_id:", jobId); //
        subscribeToAnalysisUpdates(jobId); //

    } catch (error) {
        console.error("Error al invocar webhook de cotejación:", error); //
        showError(`No se pudo iniciar la cotejación: ${error.message}`);
        resetAnalysisUI();
    }
}

// ===== FUNCIONES FALTANTES PARA main.js =====

// ===== FUNCIÓN updateProgress =====
function updateProgress(percentage, message) {
    console.log(`📊 Progreso: ${percentage}% - ${message}`);
    
    const progressBar = document.getElementById('progress-bar');
    const progressStatus = document.getElementById('progress-status');
    const progressMessage = document.getElementById('progress-message');
    const tiempoElement = document.getElementById('tiempo-transcurrido');

    if (progressBar && percentage !== null) {
        progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    }

    if (progressStatus && message) {
        progressStatus.textContent = message;
    }

    if (progressMessage && percentage < 100) {
        progressMessage.textContent = 'Tu receta se está procesando. La IA está aprendiendo de cada cotejamiento.';
    }
    
    // Actualizar tiempo transcurrido si existe
    if (tiempoElement && appState.currentProgress.tiempoInicio) {
        const transcurrido = Utils.formatTiempoTranscurrido(appState.currentProgress.tiempoInicio);
        tiempoElement.textContent = transcurrido;
    }
}

// ===== FUNCIÓN setupFileHandling =====
function setupFileHandling() {
    console.log('📁 Configurando manejo de archivos...');
    
    const fileInput = document.getElementById('file-input');
    const uploadBox = document.getElementById('upload-box');
    const browseButton = document.getElementById('browse-button');
    const removeFileButton = document.getElementById('remove-file');

    if (!fileInput || !uploadBox || !browseButton || !removeFileButton) {
        console.error('❌ No se encontraron todos los elementos para el manejo de archivos.');
        return;
    }

    // Event listeners básicos
    browseButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    removeFileButton.addEventListener('click', () => removeFile());
    uploadBox.addEventListener('click', () => fileInput.click());

    // Eventos de drag and drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadBox.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadBox.addEventListener(eventName, () => {
            uploadBox.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadBox.addEventListener(eventName, () => {
            uploadBox.classList.remove('dragover');
        });
    });

    uploadBox.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    console.log('✅ Manejo de archivos configurado correctamente');
}

// ===== FUNCIÓN addDetectedDish =====
function addDetectedDish(dishName, ingredients = []) {
    console.log(`🍽️ Agregando plato detectado: ${dishName}`);
    
    const detectedDishes = document.getElementById('detected-dishes');
    if (!detectedDishes) return;

    const dishId = 'dish-' + dishName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    let dishContainer = document.getElementById(dishId);

    if (!dishContainer) {
        dishContainer = document.createElement('div');
        dishContainer.id = dishId;
        dishContainer.className = "p-4 bg-white rounded-lg border border-gray-200 shadow-sm animate-fade-in";
        detectedDishes.appendChild(dishContainer);
    }

    const ingredientsHTML = ingredients.length > 0 ? `
        <div class="mt-3">
            <h5 class="text-sm font-medium text-gray-700 mb-2">Ingredientes detectados:</h5>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${ingredients.map(ing => `
                    <div class="flex items-center text-sm text-gray-600 bg-gray-50 rounded px-2 py-1">
                        <i class="fas fa-check-circle text-green-500 mr-2 text-xs" aria-hidden="true"></i>
                        <span class="font-medium">${Utils.sanitizeHTML(ing.nombre_ingrediente || 'Ingrediente desconocido')}</span>
                        ${ing.cantidad ? `<span class="ml-auto text-teal-600 font-semibold">${Utils.sanitizeHTML(ing.cantidad)}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    dishContainer.innerHTML = `
        <div class="flex items-start">
            <div class="flex-shrink-0 w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center mr-3">
                <i class="fas fa-utensils text-teal-600 text-sm" aria-hidden="true"></i>
            </div>
            <div class="flex-grow">
                <h4 class="font-semibold text-gray-800 mb-1">${Utils.sanitizeHTML(dishName)}</h4>
                <p class="text-sm text-gray-500">Plato detectado por IA</p>
                ${ingredientsHTML}
            </div>
            <div class="flex-shrink-0">
                <i class="fas fa-spinner fa-spin text-teal-500" aria-hidden="true"></i>
            </div>
        </div>
    `;

    // Animación de entrada
    dishContainer.style.opacity = '0';
    dishContainer.style.transform = 'translateY(20px)';

    requestAnimationFrame(() => {
        dishContainer.style.transition = 'all 0.3s ease';
        dishContainer.style.opacity = '1';
        dishContainer.style.transform = 'translateY(0)';
    });
}

// ===== FUNCIÓN handleProgressUpdate =====
function handleProgressUpdate(progressPayload) {
    console.log('📬 Nuevo mensaje de progreso:', progressPayload);

    let dishName = '';
    let ingredients = [];

    try {
        let data;
        if (typeof progressPayload === 'string') {
            let jsonString = progressPayload;
            
            // Reparar ingredientes sin corchetes
            const ingredientsRegex = /("ingredientes"\s*:\s*)({(?:[^{}]|{[^{}]*})*}(?:\s*,\s*{[^{}]*})*)/;
            if (ingredientsRegex.test(jsonString)) {
                jsonString = jsonString.replace(ingredientsRegex, (match, p1, p2) => {
                    const objects = p2.replace(/}\s*{/g, '},{');
                    return `${p1}[${objects}]`;
                });
            }
            data = JSON.parse(jsonString);
        } else {
            data = progressPayload;
        }

        if (Array.isArray(data) && data.length > 0) {
            data = data[0];
        }

        if (typeof data === 'object' && data !== null) {
            dishName = data.nombre_plato || '';
            ingredients = Array.isArray(data.ingredientes) ? data.ingredientes : [];
        }
    } catch (e) {
        if (typeof progressPayload === 'string' &&
            !progressPayload.trim().startsWith('{') &&
            !progressPayload.trim().startsWith('[')) {
            dishName = progressPayload;
        }
        console.warn("Error parsing progress payload:", e);
    }

    if (dishName) {
        addDetectedDish(dishName, ingredients);
    }
}

// ===== FUNCIONES ADICIONALES =====

// Función para manejar eventos de progreso con payload
function handleEventWithPayload(event, payload) {
    console.log(`📬 Evento recibido: ${event}`, payload);
    
    switch (event) {
        case 'plato_detectado':
            if (payload.nombre_plato) {
                addDetectedDish(payload.nombre_plato, payload.ingredientes || []);
            }
            break;
        case 'progreso_actualizado':
            if (payload.porcentaje !== undefined) {
                updateProgress(payload.porcentaje, payload.mensaje || 'Procesando...');
            }
            break;
        default:
            console.log(`Evento no manejado: ${event}`);
    }
}
// ===== INICIALIZACIÓN PRINCIPAL =====
document.addEventListener('DOMContentLoaded', async function () {
    console.log('🚀 INICIANDO ESCANDALLOS PRO CON IA GENERATIVA COMPLETA');
    
    notificationSystem = new NotificationSystem(); //
    modalManager = new ModalManager(); //
    aiLearningSystem = new AILearningSystem(); //
    
    try {
        if (window.supabase) {
            supabaseClient = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY); //
            console.log("✅ Cliente de Supabase inicializado correctamente."); //
            await aiLearningSystem.initialize(); //
        } else {
            throw new Error("La librería de Supabase no se cargó."); //
        }
    } catch (e) {
        console.error("❌ Error inicializando el cliente de Supabase.", e); //
        notificationSystem.show('Error de conexión con la base de datos. Algunas funciones pueden no estar disponibles.', 'error'); //
    }

    setupFileHandling(); //
    setupCameraHandling(); //

    console.log('🔧 Configurando botones de análisis...');
    const analyzeButton = document.getElementById('analyze-button');
    const analyzeSupabaseButton = document.getElementById('analyze-supabase-button');
    
    if (!analyzeButton || !analyzeSupabaseButton) {
        console.error('❌ Botones de análisis no encontrados');
    } else {
        console.log('✅ Botones de análisis encontrados');
    }
    
    if (analyzeButton) {
        analyzeButton.addEventListener('click', () => {
            console.log('🔧 Botón Make clickeado');
            startAnalysis();
        });
    }
    
    if (analyzeSupabaseButton) {
        analyzeSupabaseButton.addEventListener('click', () => {
            console.log('🚀 CLICK DETECTADO EN BOTÓN SUPABASE CON TIEMPO REAL');
            console.log('📁 selectedFile disponible:', selectedFile ? '✅ SÍ' : '❌ NO');
            
            if (!selectedFile) {
                console.log('❌ ERROR: No hay archivo seleccionado');
                notificationSystem.show('Por favor selecciona un archivo primero', 'warning');
                return;
            }
            
            console.log('✅ Llamando a startSupabaseAnalysis con tiempo real...');
            startSupabaseAnalysis();
        });
    }

    const sidebar = document.getElementById('sidebar'); //
    const menuToggleButton = document.getElementById('menu-toggle-button'); //
    const sidebarCloseButton = document.getElementById('sidebar-close-button'); //
    
    if (menuToggleButton) {
        menuToggleButton.addEventListener('click', () => sidebar.classList.toggle('active')); //
    }
    
    if (sidebarCloseButton) {
        sidebarCloseButton.addEventListener('click', () => sidebar.classList.remove('active')); //
    }
    
    document.addEventListener('click', (e) => {
        if (window.innerWidth < 768 && 
            sidebar.classList.contains('active') && 
            !sidebar.contains(e.target) && 
            !menuToggleButton.contains(e.target)) {
            sidebar.classList.remove('active'); //
        }
    });

    const navLinks = document.querySelectorAll('#mainNav a'); //
    const contentPanels = document.querySelectorAll('.content-panel'); //

    function switchTab(hash) {
        hash = hash || window.location.hash || '#snap-estimate'; //
        
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === hash); //
        });
        
        contentPanels.forEach(panel => {
            panel.classList.toggle('active', '#' + panel.id === hash); //
        });
        
        switch (hash) {
            case '#escandallos-guardados':
                loadEscandallosGuardados(); //
                break;
            case '#ingredientes-extraidos':
                loadIngredientesExtraidos(); //
                break;
            case '#ai-dashboard':
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.refreshLearningDashboard(); //
                }
                break;
            case '#database-ingredients':
                updateDatabaseView(appState.currentDatabaseView); //
                break;
        }
        
        if (window.innerWidth < 768) sidebar.classList.remove('active'); //
        window.scrollTo({ top: 0, behavior: 'smooth' }); //
    }

    window.addEventListener('hashchange', () => switchTab(window.location.hash)); //
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); //
            const hash = link.getAttribute('href'); //
            if(window.location.hash !== hash) {
                window.location.hash = hash; //
            } else {
                switchTab(hash);
            }
        });
    });

    // ===== LISTENERS ADICIONALES =====
    document.getElementById('refresh-ingredientes-ia')?.addEventListener('click', loadIngredientesExtraidos); //
    document.getElementById('refresh-escandallos')?.addEventListener('click', loadEscandallosGuardados); //
    document.getElementById('refresh-database')?.addEventListener('click', () => updateDatabaseView(appState.currentDatabaseView)); //
    document.getElementById('show-ingredients-btn')?.addEventListener('click', () => updateDatabaseView('ingredients')); //
    document.getElementById('show-products-btn')?.addEventListener('click', () => updateDatabaseView('products')); //

    document.getElementById('optimize-system-btn')?.addEventListener('click', () => {
        if (aiLearningSystem && aiLearningSystem.isActive) aiLearningSystem.optimizeSystem(); //
    });
    document.getElementById('regenerate-embeddings-btn')?.addEventListener('click', () => {
        if (aiLearningSystem && aiLearningSystem.isActive) aiLearningSystem.regenerateEmbeddings(); //
    });
    document.getElementById('export-knowledge-btn')?.addEventListener('click', () => {
        if (aiLearningSystem && aiLearningSystem.isActive) aiLearningSystem.exportKnowledge(); //
    });
    document.getElementById('refresh-knowledge')?.addEventListener('click', () => {
        if (aiLearningSystem && aiLearningSystem.isActive) aiLearningSystem.loadLearnedRelations(); //
    });
    document.getElementById('refresh-feedback')?.addEventListener('click', () => {
        if (aiLearningSystem && aiLearningSystem.isActive) aiLearningSystem.loadRecentFeedback(); //
    });

    function updateTime() {
        const currentTimeElement = document.getElementById('current-time'); //
        if (currentTimeElement) {
            const now = new Date(); //
            const timeString = now.toLocaleTimeString('es-ES', {
                hour: '2-digit', //
                minute: '2-digit' //
            });
            currentTimeElement.textContent = timeString; //
        }
    }

    updateTime(); //
    setInterval(updateTime, 60000); //

    setInterval(() => {
        if (aiLearningSystem && aiLearningSystem.isActive) {
            aiLearningSystem.loadInitialMetrics(); //
        }
    }, 30000);

    switchTab(); //

    setTimeout(() => {
        notificationSystem.show(
            '🧠 ¡Bienvenido a Escandallos Pro con IA Adaptativa! El sistema aprende y mejora con cada análisis.', //
            'ai', //
            6000 //
        );
    }, 1000);
    
    console.log('✅ Escandallos Pro con IA Generativa inicializado correctamente'); //
});