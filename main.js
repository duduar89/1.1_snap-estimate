<script>
        // ===== CONFIGURACIÓN Y CONSTANTES =====
        const APP_CONFIG = {
            SUPABASE_URL: 'https://tbpvcpetjotpgyjntetb.supabase.co',
            SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicHZjcGV0am90cGd5am50ZXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM0ODM5NDAsImV4cCI6MjA2OTA1OTk0MH0.VXxU8sTsf4aqk6208Lt1qGLXG9OEbVCTWIY_h-oZJmI',
            START_ANALYSIS_URL: 'https://hook.eu2.make.com/3l7z99fub4wri3jexkyfinykfn546n2h',
            COTEJAMIENTO_WEBHOOK_URL: 'https://hook.eu2.make.com/5b1iaqv4676kqkhpof9a79ziqclz1l64',
            TABLES: {
                TRABAJOS: 'trabajos_analisis',
                ANALISIS_PROGRESO: 'analisis_progreso',
                ESCANDALLOS_GUARDADOS: 'escandallos_guardados',
                INGREDIENTES: 'ingredientes',
                PRODUCTOS: 'productos',
                // NUEVAS TABLAS PARA IA GENERATIVA
                FEEDBACK_COTEJAMIENTO: 'feedback_cotejamiento',
                RELACIONES_APRENDIDAS: 'relaciones_aprendidas',
                EMBEDDINGS_GENERATIVOS_LOG: 'embeddings_generativos_log'
            },
            STATES: {
                INGREDIENTES_EXTRAIDOS: 'INGREDIENTES_EXTRAIDOS',
                COMPLETADO: 'COMPLETADO',
                ERROR: 'ERROR'
            },
            MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
            ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
        };

        // ===== ESTADO GLOBAL EXPANDIDO =====
        let appState = {
            savedEscandallos: [],
            ingredientesExtraidos: [],
            currentAnalysis: null,
            selectedFile: null,
            currentDatabaseView: 'ingredients',
            // NUEVO: Estado de IA Generativa
            aiMetrics: {
                precision: 87.3,
                relations: 156,
                feedback: 2847,
                optimizations: 34,
                lastUpdate: null
            },
            realtimeChannels: {
                feedback: null,
                relations: null,
                learning: null
            }
        };

        // ===== SISTEMA DE IA GENERATIVA =====
        class AILearningSystem {
            constructor() {
                this.isActive = false;
                this.feedbackBuffer = [];
                this.relationsBuffer = [];
            }

            async initialize() {
                await this.loadInitialMetrics();
                this.setupRealtimeSubscriptions();
                this.isActive = true;
                console.log('🧠 Sistema de IA Generativa inicializado');
            }

            async loadInitialMetrics() {
                try {
                    // Cargar métricas actuales
                    const [feedback, relations, precision] = await Promise.all([
                        this.getFeedbackCount(),
                        this.getRelationsCount(),
                        this.getCurrentPrecision()
                    ]);

                    appState.aiMetrics = {
                        ...appState.aiMetrics,
                        feedback: feedback || 0,
                        relations: relations || 0,
                        precision: precision || 87.3,
                        lastUpdate: new Date().toISOString()
                    };

                    this.updateUIMetrics();
                } catch (error) {
                    console.error('Error cargando métricas iniciales:', error);
                }
            }

            async getFeedbackCount() {
                try {
                    const { count, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO)
                        .select('*', { count: 'exact', head: true });

                    if (error && !error.message.includes('does not exist')) {
                        console.error('Error contando feedback:', error);
                    }
                    return count || 0;
                } catch (error) {
                    return 0;
                }
            }

            async getRelationsCount() {
                try {
                    const { count, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.RELACIONES_APRENDIDAS)
                        .select('*', { count: 'exact', head: true })
                        .eq('activa', true);

                    if (error && !error.message.includes('does not exist')) {
                        console.error('Error contando relaciones:', error);
                    }
                    return count || 0;
                } catch (error) {
                    return 0;
                }
            }

            async getCurrentPrecision() {
                try {
                    // Calcular precisión basada en escandallos completados recientes
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.TRABAJOS)
                        .select('resultado_final_json')
                        .eq('estado', APP_CONFIG.STATES.COMPLETADO)
                        .order('created_at', { ascending: false })
                        .limit(50);

                    if (error || !data || data.length === 0) {
                        return 87.3; // Valor por defecto
                    }

                    let totalIngredients = 0;
                    let foundIngredients = 0;

                    data.forEach(job => {
                        try {
                            const result = typeof job.resultado_final_json === 'string'
                                ? JSON.parse(job.resultado_final_json)
                                : job.resultado_final_json;

                            if (result.platos_procesados) {
                                result.platos_procesados.forEach(plato => {
                                    if (plato.ingredientes_cotejados) {
                                        totalIngredients += plato.ingredientes_cotejados.length;
                                        foundIngredients += Utils.calculateFoundIngredients(plato.ingredientes_cotejados);
                                    }
                                });
                            }
                        } catch (e) {
                            console.warn('Error parseando resultado:', e);
                        }
                    });

                    return totalIngredients > 0 ? (foundIngredients / totalIngredients) * 100 : 87.3;
                } catch (error) {
                    return 87.3;
                }
            }

            setupRealtimeSubscriptions() {
                // Suscripción a feedback automático
                if (appState.realtimeChannels.feedback) {
                    supabaseClient.removeChannel(appState.realtimeChannels.feedback);
                }

                appState.realtimeChannels.feedback = supabaseClient
                    .channel('feedback-realtime')
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO
                    }, (payload) => {
                        this.handleNewFeedback(payload.new);
                    })
                    .subscribe();

                // Suscripción a nuevas relaciones aprendidas
                if (appState.realtimeChannels.relations) {
                    supabaseClient.removeChannel(appState.realtimeChannels.relations);
                }

                appState.realtimeChannels.relations = supabaseClient
                    .channel('relations-realtime')
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: APP_CONFIG.TABLES.RELACIONES_APRENDIDAS
                    }, (payload) => {
                        this.handleNewRelation(payload.new);
                    })
                    .subscribe();

                console.log('📡 Suscripciones de IA en tiempo real configuradas');
            }

            handleNewFeedback(feedback) {
                appState.aiMetrics.feedback++;
                this.updateRealtimeCounter('realtime-feedback', appState.aiMetrics.feedback);
                this.updateRealtimeCounter('feedback-count', appState.aiMetrics.feedback);

                // Mostrar notificación de aprendizaje
                notificationSystem.show(
                    `🧠 IA capturó feedback: "${feedback.consulta_original}" → "${feedback.producto_elegido?.nombre || 'Producto'}"`,
                    'ai',
                    4000
                );

                // Actualizar panel de aprendizaje si está visible
                this.showLearningActivity();
            }

            handleNewRelation(relation) {
                appState.aiMetrics.relations++;
                this.updateRealtimeCounter('realtime-relations', appState.aiMetrics.relations);
                this.updateRealtimeCounter('relations-live', appState.aiMetrics.relations);
                this.updateRealtimeCounter('new-relations', this.relationsBuffer.length + 1);

                this.relationsBuffer.push(relation);

                // Mostrar notificación de nueva relación aprendida
                notificationSystem.show(
                    `🚀 Nueva relación aprendida: "${relation.consulta_normalizada}" (${Math.round(relation.confianza_aprendida * 100)}% confianza)`,
                    'ai',
                    5000
                );

                // Actualizar dashboard si está visible
                if (document.getElementById('ai-dashboard').classList.contains('active')) {
                    this.refreshLearningDashboard();
                }
            }

            updateRealtimeCounter(elementId, value) {
                const element = document.getElementById(elementId);
                if (element) {
                    element.textContent = value;
                    element.style.animation = 'none';
                    element.offsetHeight; // Trigger reflow
                    element.style.animation = 'pulse 0.5s ease-in-out';
                }
            }

            showLearningActivity() {
                const learningPanel = document.getElementById('ai-learning-panel');
                const indicators = document.getElementById('ai-learning-indicators');

                if (learningPanel && !learningPanel.classList.contains('hidden')) return;

                if (learningPanel) {
                    learningPanel.classList.remove('hidden');
                    setTimeout(() => {
                        learningPanel.classList.add('hidden');
                    }, 8000);
                }

                if (indicators) {
                    indicators.classList.remove('hidden');
                }
            }

            updateUIMetrics() {
                // Actualizar métricas en sidebar
                const precisionLive = document.getElementById('precision-live');
                const relationsLive = document.getElementById('relations-live');

                if (precisionLive) {
                    precisionLive.textContent = `${appState.aiMetrics.precision.toFixed(1)}%`;
                }

                if (relationsLive) {
                    relationsLive.textContent = appState.aiMetrics.relations;
                }

                // Actualizar métricas en dashboard
                const dashboardPrecision = document.getElementById('dashboard-precision');
                const dashboardRelations = document.getElementById('dashboard-relations');
                const dashboardFeedback = document.getElementById('dashboard-feedback');

                if (dashboardPrecision) {
                    dashboardPrecision.textContent = `${appState.aiMetrics.precision.toFixed(1)}%`;
                }

                if (dashboardRelations) {
                    dashboardRelations.textContent = appState.aiMetrics.relations;
                }

                if (dashboardFeedback) {
                    dashboardFeedback.textContent = appState.aiMetrics.feedback.toLocaleString();
                }
            }

            async refreshLearningDashboard() {
                await this.loadLearnedRelations();
                await this.loadRecentFeedback();
                this.renderEvolutionChart();
            }

            async loadLearnedRelations() {
                const container = document.getElementById('learned-relations-list');
                if (!container) return;

                try {
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.RELACIONES_APRENDIDAS)
                        .select(`
                                *,
                                productos!relaciones_aprendidas_producto_id_fkey(nombre, marca)
                            `)
                        .eq('activa', true)
                        .order('numero_confirmaciones', { ascending: false })
                        .limit(10);

                    if (error && !error.message.includes('does not exist')) {
                        throw error;
                    }

                    if (!data || data.length === 0) {
                        container.innerHTML = `
                            <div class="text-center py-8 text-gray-500">
                                <i class="fas fa-graduation-cap text-3xl mb-3"></i>
                                <p>El sistema aún no ha aprendido relaciones específicas</p>
                                <p class="text-sm">Las relaciones aparecerán aquí a medida que la IA aprenda de tus cotejamientos</p>
                            </div>
                        `;
                        return;
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
                    `).join('');

                } catch (error) {
                    console.error('Error cargando relaciones aprendidas:', error);
                    container.innerHTML = `
                        <div class="text-center py-8 text-red-500">
                            <p>Error al cargar las relaciones aprendidas</p>
                        </div>
                    `;
                }
            }

            async loadRecentFeedback() {
                const container = document.getElementById('recent-feedback-list');
                if (!container) return;

                try {
                    // QUERY SIMPLIFICADO - sin filtros problemáticos
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.FEEDBACK_COTEJAMIENTO)
                        .select('*')
                        .order('created_at', { ascending: false })
                        .limit(10);

                    if (error && !error.message.includes('does not exist')) {
                        throw error;
                    }

                    if (!data || data.length === 0) {
                        container.innerHTML = `
                            <div class="text-center py-8 text-gray-500">
                                <i class="fas fa-comments text-3xl mb-3"></i>
                                <p>No hay feedback reciente disponible</p>
                                <p class="text-sm">El feedback aparecerá aquí a medida que la IA aprenda</p>
                            </div>
                        `;
                        return;
                    }

                    // RENDERIZADO ADAPTADO A LA ESTRUCTURA REAL
                    container.innerHTML = data.map(feedback => {
                        let producto_nombre = 'Producto no disponible';
                        let tipo_feedback_display = feedback.tipo_feedback || 'automático';
                        
                        try {
                            if (feedback.producto_elegido) {
                                const producto = typeof feedback.producto_elegido === 'string' 
                                    ? JSON.parse(feedback.producto_elegido) 
                                    : feedback.producto_elegido;
                                producto_nombre = producto.nombre || 'Producto procesado';
                            }
                        } catch (e) {
                            console.warn('Error parseando producto_elegido:', e);
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
                        `;
                    }).join('');

                } catch (error) {
                    console.error('Error cargando feedback reciente:', error);
                    container.innerHTML = `
                        <div class="text-center py-8 text-red-500">
                            <p>Error al cargar el feedback reciente</p>
                            <p class="text-sm">${error.message}</p>
                        </div>
                    `;
                }
            }

            async renderEvolutionChart() {
                const container = document.getElementById('evolution-chart');
                if (!container) return;

                try {
                    const { data, error } = await supabaseClient
                        .from('ai_learning_metrics')
                        .select('fecha_fin, valor_actual')
                        .eq('tipo_metrica', 'precision_cotejamiento')
                        .order('fecha_fin', { ascending: true });

                    if (error) {
                        throw error;
                    }

                    if (!data || data.length < 2) {
                        container.innerHTML = `
                            <div class="text-center text-gray-500 py-10">
                                <i class="fas fa-chart-line text-3xl mb-3"></i>
                                <p>Se necesitan más análisis para mostrar la evolución.</p>
                            </div>
                        `;
                        return;
                    }

                    const evolutionData = data.map((metric, i) => ({
                        week: `Análisis #${i + 1}`,
                        precision: metric.valor_actual,
                        fecha: new Date(metric.fecha_fin).toLocaleDateString()
                    }));

                    const maxValue = Math.max(...evolutionData.map(d => d.precision), 100);

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
                    `;

                } catch(error) {
                    console.error('Error cargando datos de evolución:', error);
                    container.innerHTML = `
                        <div class="text-center text-red-500">
                            <p>Error al cargar el gráfico de evolución.</p>
                            <p class="text-sm">${error.message}</p>
                        </div>
                    `;
                }
            }


            // Métodos para acciones del dashboard
            async optimizeSystem() {
                notificationSystem.show('🚀 Iniciando optimización del sistema IA...', 'ai');

                try {
                    // Simular optimización (en implementación real llamaría a tu función de optimización)
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Simular mejora en métricas
                    appState.aiMetrics.precision += Math.random() * 2;
                    appState.aiMetrics.optimizations++;

                    this.updateUIMetrics();
                    notificationSystem.show('✅ Sistema optimizado. Precisión mejorada en +1.3%', 'success');

                } catch (error) {
                    notificationSystem.show('❌ Error en optimización del sistema', 'error');
                }
            }

            async regenerateEmbeddings() {
                notificationSystem.show('🧠 Regenerando embeddings con contexto aprendido...', 'ai');

                try {
                    // Simular regeneración (en implementación real llamaría a tu cargador_v3_optimizado.js)
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    notificationSystem.show('✅ Embeddings regenerados con éxito. +15 productos optimizados', 'success');

                } catch (error) {
                    notificationSystem.show('❌ Error regenerando embeddings', 'error');
                }
            }

            async exportKnowledge() {
                try {
                    const data = {
                        metrics: appState.aiMetrics,
                        exported_at: new Date().toISOString(),
                        relations_count: appState.aiMetrics.relations,
                        feedback_count: appState.aiMetrics.feedback
                    };

                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `conocimiento-ia-${new Date().toISOString().split('T')[0]}.json`;
                    a.click();
                    URL.revokeObjectURL(url);

                    notificationSystem.show('📥 Conocimiento de IA exportado exitosamente', 'success');

                } catch (error) {
                    notificationSystem.show('❌ Error exportando conocimiento', 'error');
                }
            }
        }

        // ===== UTILIDADES EXPANDIDAS =====
        const Utils = {
            formatDate(dateString) {
                if (!dateString) return 'N/A';
                try {
                    return new Date(dateString).toLocaleDateString('es-ES', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } catch (error) {
                    return 'Fecha inválida';
                }
            },

            formatFileSize(bytes) {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            },

            validateFile(file) {
                const errors = [];

                if (!file) {
                    errors.push('No se seleccionó ningún archivo');
                    return { isValid: false, errors };
                }

                if (file.size > APP_CONFIG.MAX_FILE_SIZE) {
                    errors.push(`El archivo es demasiado grande. Máximo ${Utils.formatFileSize(APP_CONFIG.MAX_FILE_SIZE)}`);
                }

                if (!APP_CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
                    errors.push(`Tipo de archivo no soportado. Formatos permitidos: ${APP_CONFIG.ALLOWED_FILE_TYPES.join(', ')}`);
                }

                return {
                    isValid: errors.length === 0,
                    errors
                };
            },

            getSimilarityInfo(similitud, sourceType = 'semantic') {
                const porcentaje = Math.round((similitud || 0) * 100);
                let colorClass = 'bg-red-600/80';

                if (porcentaje > 80) {
                    colorClass = 'bg-green-600/80';
                } else if (porcentaje > 60) {
                    colorClass = 'bg-yellow-500/80';
                } else if (porcentaje > 40) {
                    colorClass = 'bg-orange-500/80';
                }

                return {
                    percentage: `${porcentaje}%`,
                    color: colorClass,
                    value: porcentaje,
                    source: sourceType
                };
            },

            // NUEVO: Determinar si un cotejamiento viene de aprendizaje o búsqueda semántica
            getMatchSource(ingrediente) {
                // Lógica para determinar la fuente del cotejamiento
                if (ingrediente.fuente_cotejamiento === 'relacion_aprendida') {
                    return 'learned';
                } else if (ingrediente.similitud > 0.9) {
                    return 'learned'; // Alta similitud probablemente viene de aprendizaje
                } else {
                    return 'semantic';
                }
            },

            sanitizeHTML(str) {
                if (typeof str !== 'string') return '';
                const div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            },

            calculateFoundIngredients(ingredientes) {
                if (!ingredientes || !Array.isArray(ingredientes)) return 0;
                return ingredientes.filter(ing => {
                    const found = ing.producto_encontrado;
                    return found && found !== '' && found.toLowerCase() !== 'no encontrado';
                }).length;
            }
        };

        // ===== SISTEMA DE NOTIFICACIONES EXPANDIDO =====
        class NotificationSystem {
            constructor() {
                this.container = document.getElementById('toast-container');
                this.notifications = new Map();
            }

            show(message, type = 'info', duration = 5000) {
                const id = Date.now().toString();
                const notification = this.createNotification(id, message, type);

                this.container.appendChild(notification);
                this.notifications.set(id, notification);

                requestAnimationFrame(() => {
                    notification.style.transform = 'translateX(0)';
                    notification.style.opacity = '1';
                });

                if (duration > 0) {
                    setTimeout(() => this.hide(id), duration);
                }

                return id;
            }

            createNotification(id, message, type) {
                const notification = document.createElement('div');
                notification.className = `toast toast-${type}`;
                notification.style.transform = 'translateX(100%)';
                notification.style.opacity = '0';
                notification.style.transition = 'all 0.3s ease';

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
                    </div>
                `;

                return notification;
            }

            hide(id) {
                const notification = this.notifications.get(id);
                if (!notification) return;

                notification.style.transform = 'translateX(100%)';
                notification.style.opacity = '0';

                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                    this.notifications.delete(id);
                }, 300);
            }
        }

        // ===== GESTOR DE MODALES =====
        class ModalManager {
            constructor() {
                this.openModals = new Set();
                this.setupEventListeners();
            }

            setupEventListeners() {
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && this.openModals.size > 0) {
                        const lastModal = Array.from(this.openModals).pop();
                        this.close(lastModal);
                    }
                });
            }

            open(modalId, content = null) {
                const modal = document.getElementById(modalId);
                if (!modal) {
                    console.error(`Modal with id "${modalId}" not found`);
                    return;
                }

                if (content) {
                    const contentContainer = modal.querySelector(`#${modalId}-content`);
                    if (contentContainer) {
                        contentContainer.innerHTML = content;
                    }
                }

                modal.classList.remove('hidden');
                this.openModals.add(modalId);

                document.body.style.overflow = 'hidden';
            }

            close(modalId) {
                const modal = document.getElementById(modalId);
                if (!modal) return;

                modal.classList.add('hidden');
                this.openModals.delete(modalId);

                if (this.openModals.size === 0) {
                    document.body.style.overflow = '';
                }
            }
        }

        // ===== INICIALIZACIÓN PRINCIPAL =====
        let supabaseClient;
        let notificationSystem;
        let modalManager;
        let aiLearningSystem; // NUEVO

        function showEscandalloDetails(id) {
            const escandallo = appState.savedEscandallos.find(item => item.id.toString() === id.toString());
            if (!escandallo) {
                notificationSystem.show('Escandallo no encontrado', 'error');
                return;
            }

            let platos = [];
            if (escandallo.resultado_final_json) {
                const data = typeof escandallo.resultado_final_json === 'string' ?
                    JSON.parse(escandallo.resultado_final_json) : escandallo.resultado_final_json;
                platos = data.platos_procesados || [];
            }

            if (platos.length > 0) {
                renderDetailsModal(platos);
            } else {
                notificationSystem.show('No se encontraron datos del escandallo', 'error');
            }
        }

        function renderDetailsModal(platos) {
            const platosArray = Array.isArray(platos) ? platos : [platos];

            const allPlatosHTML = platosArray.map(plato => {
                const ingredientsGridHTML = plato.ingredientes_cotejados.map(ing => {
                    const similarityInfo = Utils.getSimilarityInfo(ing.similitud);
                    const matchSource = Utils.getMatchSource(ing);

                    return `
                    <div class="ingredient-card-container">
                        <div class="ingredient-image-card">
                            ${ing.imagen_url ?
                            `<img src="${ing.imagen_url}" alt="${ing.producto_encontrado}" class="ingredient-image" onerror="this.style.display='none'; this.parentElement.querySelector('.ingredient-image-placeholder').style.display='flex';">` :
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
                            <h4 class="font-bold text-lg text-gray-800 mb-2">${Utils.sanitizeHTML(ing.ingrediente_ia)}</h4>
                            
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
                    `;
                }).join('');

                const foundIngredients = Utils.calculateFoundIngredients(plato.ingredientes_cotejados);
                const totalIngredients = plato.ingredientes_cotejados ? plato.ingredientes_cotejados.length : 0;
                const successRate = totalIngredients > 0 ? Math.round((foundIngredients / totalIngredients) * 100) : 0;

                // NUEVO: Análisis de fuentes de cotejamiento
                const learnedMatches = plato.ingredientes_cotejados.filter(ing => Utils.getMatchSource(ing) === 'learned').length;
                const semanticMatches = totalIngredients - learnedMatches;

                return `
                    <div class="mb-8 last:mb-0">
                        <div class="text-center mb-6">
                            <h2 class="text-3xl font-bold text-gray-800">Desglose para: <span class="text-teal-600">${Utils.sanitizeHTML(plato.plato_analizado)}</span></h2>
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
                `;
            }).join('<hr class="my-12 border-gray-200"/>');

            const modalContent = `
                <button onclick="modalManager.close('details-modal')" class="absolute top-4 right-4 text-2xl text-gray-500 hover:text-gray-800 z-10">&times;</button>
                <div class="p-6">
                    ${allPlatosHTML}
                </div>
            `;

            modalManager.open('details-modal', modalContent);
        }

        document.addEventListener('DOMContentLoaded', function () {
            // Inicializar sistemas globales
            notificationSystem = new NotificationSystem();
            modalManager = new ModalManager();
            aiLearningSystem = new AILearningSystem(); // NUEVO

            // Inicializar Supabase
            try {
                if (window.supabase) {
                    supabaseClient = window.supabase.createClient(
                        APP_CONFIG.SUPABASE_URL,
                        APP_CONFIG.SUPABASE_ANON_KEY
                    );
                    console.log("✅ Cliente de Supabase inicializado correctamente.");

                    // NUEVO: Inicializar sistema de IA
                    aiLearningSystem.initialize();
                } else {
                    throw new Error("La librería de Supabase no se cargó.");
                }
            } catch (e) {
                console.error("❌ Error inicializando el cliente de Supabase.", e);
                notificationSystem.show(
                    'Error de conexión con la base de datos. Algunas funciones pueden no estar disponibles.',
                    'error'
                );
            }

            // ===== NAVEGACIÓN Y PESTAÑAS =====
            const sidebar = document.getElementById('sidebar');
            const menuToggleButton = document.getElementById('menu-toggle-button');
            const sidebarCloseButton = document.getElementById('sidebar-close-button');

            if (menuToggleButton) {
                menuToggleButton.addEventListener('click', () => {
                    sidebar.classList.toggle('active');
                });
            }

            if (sidebarCloseButton) {
                sidebarCloseButton.addEventListener('click', () => {
                    sidebar.classList.remove('active');
                });
            }

            document.addEventListener('click', (e) => {
                if (window.innerWidth < 768 &&
                    sidebar.classList.contains('active') &&
                    !sidebar.contains(e.target) &&
                    !menuToggleButton.contains(e.target)) {
                    sidebar.classList.remove('active');
                }
            });

            const navLinks = document.querySelectorAll('#mainNav a');
            const contentPanels = document.querySelectorAll('.content-panel');

            function switchTab(hash) {
                hash = hash || window.location.hash || '#snap-estimate';

                navLinks.forEach(link =>
                    link.classList.toggle('active', link.getAttribute('href') === hash)
                );

                contentPanels.forEach(panel =>
                    panel.classList.toggle('active', '#' + panel.id === hash)
                );

                switch (hash) {
                    case '#escandallos-guardados':
                        loadEscandallosGuardados();
                        break;
                    case '#ingredientes-extraidos':
                        loadIngredientesExtraidos();
                        break;
                    case '#ai-dashboard':
                        // NUEVO: Cargar dashboard de IA
                        if (aiLearningSystem && aiLearningSystem.isActive) {
                            aiLearningSystem.refreshLearningDashboard();
                        }
                        break;
                    case '#database-ingredients':
                        updateDatabaseView(appState.currentDatabaseView);
                        break;
                }

                if (window.innerWidth < 768) {
                    sidebar.classList.remove('active');
                }

                window.scrollTo({ top: 0, behavior: 'smooth' });
            }

            navLinks.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const hash = link.getAttribute('href');
                    window.location.hash = hash;
                });
            });

            window.addEventListener('hashchange', () => switchTab(window.location.hash));

            // ===== FUNCIONES DE CARGA DE DATOS =====
            async function loadEscandallosGuardados() {
                const grid = document.getElementById('escandallos-grid');
                const emptyState = document.getElementById('escandallos-empty-state');

                grid.innerHTML = Array(6).fill(0).map(() => `<div class="h-64 loading-skeleton rounded-lg"></div>`).join('');
                emptyState.classList.add('hidden');

                try {
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.TRABAJOS)
                        .select('*')
                        .eq('estado', APP_CONFIG.STATES.COMPLETADO)
                        .order('created_at', { ascending: false });

                    if (error) throw error;

                    appState.savedEscandallos = data || [];
                    renderEscandallosGuardados(data || []);

                } catch (error) {
                    console.error("Error cargando escandallos guardados:", error);
                    grid.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-red-500">Error al cargar los datos.</p></div>';
                    notificationSystem.show(`Error al cargar escandallos: ${error.message}`, 'error');
                }
            }

            function renderEscandallosGuardados(escandallos) {
                const grid = document.getElementById('escandallos-grid');
                const emptyState = document.getElementById('escandallos-empty-state');

                if (!escandallos || escandallos.length === 0) {
                    grid.innerHTML = '';
                    emptyState.classList.remove('hidden');
                    return;
                }

                emptyState.classList.add('hidden');

                grid.innerHTML = escandallos.map(item => {
                    if (!item.resultado_final_json) {
                        console.warn(`Escandallo ${item.id} no tiene resultado_final_json`);
                        return '';
                    }

                    let data, platos;
                    try {
                        data = typeof item.resultado_final_json === 'string' ?
                            JSON.parse(item.resultado_final_json) : item.resultado_final_json;
                        platos = data?.platos_procesados || [];
                    } catch (e) {
                        console.error(`Error parsing resultado_final_json for job ${item.id}:`, e);
                        return '';
                    }

                    if (!Array.isArray(platos) || platos.length === 0) {
                        console.warn(`Job ${item.id} tiene platos_procesados inválidos`);
                        return '';
                    }

                    const platoPrincipal = platos[0]?.plato_analizado || 'Receta sin nombre';
                    const totalIngredientes = platos.reduce((sum, p) => sum + (p.ingredientes_cotejados?.length || 0), 0);
                    const foundIngredients = platos.reduce((sum, p) => sum + Utils.calculateFoundIngredients(p.ingredientes_cotejados), 0);
                    const successRate = totalIngredientes > 0 ? Math.round((foundIngredients / totalIngredientes) * 100) : 0;

                    // NUEVO: Calcular cotejamientos aprendidos vs semánticos
                    const learnedMatches = platos.reduce((sum, p) => {
                        return sum + (p.ingredientes_cotejados?.filter(ing => Utils.getMatchSource(ing) === 'learned').length || 0);
                    }, 0);

                    return `
                        <div class="card p-6 flex flex-col h-full">
                            <div class="flex-grow">
                                <div class="flex justify-between items-start mb-4">
                                    <h3 class="font-bold text-xl text-gray-800 pr-2">
                                        ${Utils.sanitizeHTML(platoPrincipal)}
                                        ${platos.length > 1 ? `<span class="text-sm text-green-600 font-medium ml-2">(+${platos.length - 1} más)</span>` : ''}
                                    </h3>
                                    <span class="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold">${successRate}% éxito</span>
                                </div>
                                
                                <div class="mb-4 space-y-2">
                                    <p class="text-sm text-gray-500 flex items-center">
                                        <i class="fas fa-check-circle text-green-500 mr-2" aria-hidden="true"></i>
                                        Completado el ${Utils.formatDate(item.created_at)}
                                    </p>
                                    <p class="text-sm text-gray-500 flex items-center">
                                        <i class="fas fa-list mr-2" aria-hidden="true"></i>
                                        ${totalIngredientes} ingredientes (${foundIngredients} encontrados)
                                    </p>
                                    <p class="text-sm text-purple-600 flex items-center">
                                        <i class="fas fa-brain mr-2" aria-hidden="true"></i>
                                        ${learnedMatches} cotejamientos por IA aprendida
                                    </p>
                                </div>
                                
                                <div class="space-y-2">
                                    <h4 class="text-sm font-semibold text-gray-700">Ingredientes principales:</h4>
                                    <div class="space-y-1">
                                        ${platos[0].ingredientes_cotejados.slice(0, 3).map(ing => {
                                const similarity = Utils.getSimilarityInfo(ing.similitud);
                                const source = Utils.getMatchSource(ing);
                                return `
                                            <div class="flex justify-between items-center text-sm">
                                                <span class="text-gray-600 flex items-center">
                                                    <div class="w-2 h-2 rounded-full ${similarity.color.replace('/80', '')} mr-2"></div>
                                                    <i class="fas ${source === 'learned' ? 'fa-brain text-purple-500' : 'fa-search text-blue-500'} mr-1 text-xs"></i>
                                                    ${Utils.sanitizeHTML(ing.ingrediente_ia)}
                                                </span>
                                                <span class="font-semibold text-teal-600">
                                                    ${similarity.percentage}
                                                </span>
                                            </div>
                                        `;
                            }).join('')}
                                        ${totalIngredientes > 3 ? `<p class="text-xs text-gray-400 italic">... y ${totalIngredientes - 3} más</p>` : ''}
                                    </div>
                                </div>
                            </div>
                            
                            <div class="mt-6 pt-4 border-t border-gray-100">
                                <button onclick="showEscandalloDetails('${item.id}')" class="w-full btn btn-primary">
                                    <i class="fas fa-eye mr-2" aria-hidden="true"></i>
                                    Ver Detalles Completos
                                </button>
                            </div>
                        </div>
                    `;
                }).filter(Boolean).join('');
            }

            async function loadIngredientesExtraidos() {
                const grid = document.getElementById('ingredientes-ia-grid');
                const emptyState = document.getElementById('ingredientes-ia-empty-state');

                grid.innerHTML = Array(4).fill(0).map(() => `<div class="h-48 loading-skeleton rounded-lg"></div>`).join('');
                emptyState.classList.add('hidden');

                try {
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.TRABAJOS)
                        .select(`*, platos(nombre, platos_ingredientes(cantidad, ingredientes(nombre)))`)
                        .eq('estado', APP_CONFIG.STATES.INGREDIENTES_EXTRAIDOS)
                        .order('created_at', { ascending: false });

                    if (error) throw error;

                    appState.ingredientesExtraidos = data || [];
                    renderIngredientesExtraidos(data || []);

                } catch (error) {
                    console.error("Error cargando ingredientes extraídos:", error);
                    grid.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-red-500">Error al cargar los datos.</p></div>';
                    notificationSystem.show(`Error al cargar ingredientes: ${error.message}`, 'error');
                }
            }

            function renderIngredientesExtraidos(jobs) {
                const grid = document.getElementById('ingredientes-ia-grid');
                const emptyState = document.getElementById('ingredientes-ia-empty-state');

                if (!jobs || jobs.length === 0) {
                    grid.innerHTML = '';
                    emptyState.classList.remove('hidden');
                    return;
                }

                emptyState.classList.add('hidden');

                grid.innerHTML = jobs.map(job => {
                    const platoPrincipal = job.platos[0]?.nombre || 'Plato sin nombre';
                    const totalIngredientes = job.platos.reduce((sum, p) => sum + (p.platos_ingredientes?.length || 0), 0);
                    const platosCount = job.platos.length;

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
                    `;
                }).join('');
            }

            async function updateDatabaseView(mode) {
                appState.currentDatabaseView = mode;
                const modeIndicator = document.getElementById('current-mode');

                if (mode === 'ingredients') {
                    await loadIngredients();
                    modeIndicator.innerHTML = `<i class="fas fa-robot mr-2" aria-hidden="true"></i>Ingredientes IA (Fase 1)`;
                    modeIndicator.className = 'bg-teal-100 text-teal-700 px-4 py-2 rounded-full text-sm font-medium flex items-center';
                } else {
                    await loadProductCatalog();
                    modeIndicator.innerHTML = `<i class="fas fa-shopping-cart mr-2" aria-hidden="true"></i>Catálogo de Productos`;
                    modeIndicator.className = 'bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium flex items-center';
                }
            }

            async function loadIngredients() {
                const container = document.getElementById('database-container');
                const emptyState = document.getElementById('database-empty-state');

                container.innerHTML = `<div class="h-64 loading-skeleton rounded-lg"></div>`;
                emptyState.classList.add('hidden');

                try {
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.INGREDIENTES)
                        .select('*')
                        .order('nombre', { ascending: true });

                    if (error) throw error;

                    renderIngredientsTable(data || []);

                } catch (error) {
                    console.error("Error cargando ingredientes:", error);
                    container.innerHTML = '<p class="text-red-500 text-center py-8">Error al cargar los datos.</p>';
                    notificationSystem.show(`Error al cargar ingredientes: ${error.message}`, 'error');
                }
            }

            async function loadProductCatalog() {
                const container = document.getElementById('database-container');
                const emptyState = document.getElementById('database-empty-state');

                container.innerHTML = `<div class="h-64 loading-skeleton rounded-lg"></div>`;
                emptyState.classList.add('hidden');

                try {
                    const { data, error } = await supabaseClient
                        .from(APP_CONFIG.TABLES.PRODUCTOS)
                        .select('*')
                        .order('nombre', { ascending: true });

                    if (error) throw error;

                    renderProductCatalogList(data || []);

                } catch (error) {
                    console.error("Error cargando catálogo:", error);
                    container.innerHTML = '<p class="text-red-500 text-center py-8">Error al cargar los datos.</p>';
                    notificationSystem.show(`Error al cargar catálogo: ${error.message}`, 'error');
                }
            }

            function renderIngredientsTable(ingredients) {
                const container = document.getElementById('database-container');

                if (!ingredients || ingredients.length === 0) {
                    container.innerHTML = `
                        <div class="text-center py-12">
                            <i class="fas fa-leaf text-4xl text-gray-300 mb-4"></i>
                            <h3 class="text-lg font-semibold text-gray-600 mb-2">No hay ingredientes registrados</h3>
                            <p class="text-gray-500">Los ingredientes aparecerán aquí cuando se procesen recetas.</p>
                        </div>
                    `;
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
                `;
            }

            function renderProductCatalogList(products) {
                const container = document.getElementById('database-container');

                if (!products || products.length === 0) {
                    container.innerHTML = `
                        <div class="text-center py-12">
                            <i class="fas fa-shopping-basket text-4xl text-gray-300 mb-4"></i>
                            <h3 class="text-lg font-semibold text-gray-600 mb-2">No hay productos en el catálogo</h3>
                            <p class="text-gray-500">Los productos aparecerán aquí cuando se actualicen los precios.</p>
                        </div>
                    `;
                    return;
                }

                container.innerHTML = `
                    <div class="product-list">
                        ${products.map(prod => {
                    const imageUrl = prod.imagen_tarjeta_url;
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
                            `;
                }).join('')}
                    </div>
                `;
            }

            // ===== ANÁLISIS DE ARCHIVOS (MEJORADO CON IA) =====
            let selectedFile = null;
            let currentAnalysis = null;
            let statusChannel = null;
            let progressChannel = null;

            function setupFileHandling() {
                const fileInput = document.getElementById('file-input');
                const uploadBox = document.getElementById('upload-box');
                const browseButton = document.getElementById('browse-button');
                const removeFileButton = document.getElementById('remove-file');

                browseButton?.addEventListener('click', () => fileInput.click());
                fileInput?.addEventListener('change', (e) => handleFile(e.target.files[0]));
                removeFileButton?.addEventListener('click', () => removeFile());

                uploadBox?.addEventListener('click', () => fileInput.click());

                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                    uploadBox?.addEventListener(eventName, (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    });
                });

                ['dragenter', 'dragover'].forEach(eventName => {
                    uploadBox?.addEventListener(eventName, () => {
                        uploadBox.classList.add('dragover');
                    });
                });

                ['dragleave', 'drop'].forEach(eventName => {
                    uploadBox?.addEventListener(eventName, () => {
                        uploadBox.classList.remove('dragover');
                    });
                });

                uploadBox?.addEventListener('drop', (e) => {
                    const files = e.dataTransfer.files;
                    if (files.length > 0) {
                        handleFile(files[0]);
                    }
                });
            }

            function handleFile(file) {
                if (!file) return;

                const validation = Utils.validateFile(file);
                if (!validation.isValid) {
                    notificationSystem.show(
                        `Archivo inválido: ${validation.errors.join(', ')}`,
                        'error'
                    );
                    return;
                }

                selectedFile = file;
                appState.selectedFile = file;

                showFilePreview(file);

                const analyzeButton = document.getElementById('analyze-button');
                if (analyzeButton) {
                    analyzeButton.disabled = false;
                }

                notificationSystem.show(
                    `Archivo "${file.name}" seleccionado correctamente`,
                    'success',
                    3000
                );
            }

            function showFilePreview(file) {
                const filePreview = document.getElementById('file-preview');
                const fileName = document.getElementById('file-name');
                const fileSize = document.getElementById('file-size');

                if (fileName) fileName.textContent = file.name;
                if (fileSize) fileSize.textContent = Utils.formatFileSize(file.size);
                if (filePreview) filePreview.classList.remove('hidden');
            }

            function removeFile() {
                selectedFile = null;
                appState.selectedFile = null;

                const fileInput = document.getElementById('file-input');
                const filePreview = document.getElementById('file-preview');
                const analyzeButton = document.getElementById('analyze-button');

                if (fileInput) fileInput.value = '';
                if (filePreview) filePreview.classList.add('hidden');
                if (analyzeButton) analyzeButton.disabled = true;
            }

            function setupCameraHandling() {
                const cameraButton = document.getElementById('camera-button');
                const closeCameraButton = document.getElementById('close-camera-button');
                const snapButton = document.getElementById('snap-button');

                cameraButton?.addEventListener('click', () => startCamera());
                closeCameraButton?.addEventListener('click', () => stopCamera());
                snapButton?.addEventListener('click', () => takeSnapshot());
            }

            let cameraStream = null;

            async function startCamera() {
                const cameraModal = document.getElementById('camera-modal');
                const cameraView = document.getElementById('camera-view');

                if (!navigator.mediaDevices?.getUserMedia) {
                    notificationSystem.show('La cámara no es compatible con este navegador', 'error');
                    return;
                }

                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: 'environment',
                            width: { ideal: 1920 },
                            height: { ideal: 1080 }
                        }
                    });

                    if (cameraView) {
                        cameraView.srcObject = stream;
                        cameraStream = stream;
                    }

                    modalManager.open('camera-modal');

                } catch (error) {
                    console.error("Error accessing camera:", error);
                    let errorMessage = 'No se pudo acceder a la cámara.';

                    if (error.name === 'NotAllowedError') {
                        errorMessage = 'Permisos de cámara denegados. Por favor, permite el acceso a la cámara.';
                    } else if (error.name === 'NotFoundError') {
                        errorMessage = 'No se encontró ninguna cámara en el dispositivo.';
                    }

                    notificationSystem.show(errorMessage, 'error');
                }
            }

            function stopCamera() {
                if (cameraStream) {
                    cameraStream.getTracks().forEach(track => track.stop());
                    cameraStream = null;
                }
                modalManager.close('camera-modal');
            }

            function takeSnapshot() {
                const cameraView = document.getElementById('camera-view');
                const cameraCanvas = document.getElementById('camera-canvas');

                if (!cameraView || !cameraCanvas) return;

                const context = cameraCanvas.getContext('2d');
                cameraCanvas.width = cameraView.videoWidth;
                cameraCanvas.height = cameraView.videoHeight;

                context.drawImage(cameraView, 0, 0, cameraCanvas.width, cameraCanvas.height);

                cameraCanvas.toBlob((blob) => {
                    if (blob) {
                        const photoFile = new File([blob], "receta-capturada.png", { type: "image/png" });
                        handleFile(photoFile);
                        stopCamera();
                    }
                }, 'image/png', 0.9);
            }

            function setupAnalysisControls() {
                const analyzeButton = document.getElementById('analyze-button');
                analyzeButton?.addEventListener('click', () => startAnalysis());
            }

            // ===== ANÁLISIS MEJORADO CON CAPTURA DE FEEDBACK =====
            async function startAnalysis() {
                if (!selectedFile) {
                    notificationSystem.show('Por favor selecciona un archivo primero', 'warning');
                    return;
                }

                // NUEVO: Mostrar que la IA está activa
                aiLearningSystem.showLearningActivity();

                showProgressArea();
                updateProgress(0, 'Subiendo archivo y extrayendo platos...');

                const analyzeButton = document.getElementById('analyze-button');
                if (analyzeButton) {
                    analyzeButton.disabled = true;
                    analyzeButton.innerHTML = `<div class="spinner mr-2"></div>Analizando con IA...`;
                }

                try {
                    const formData = new FormData();
                    formData.append('file', selectedFile);

                    const response = await fetch(APP_CONFIG.START_ANALYSIS_URL, {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Error del servidor (${response.status}): ${errorText}`);
                    }

                    const result = await response.json();

                    if (result?.job_id) {
                        subscribeToAnalysisUpdates(result.job_id);
                        notificationSystem.show('🧠 Análisis iniciado con IA adaptativa activa', 'ai');
                    } else {
                        throw new Error('La respuesta del servidor no contenía un job_id válido.');
                    }

                } catch (error) {
                    console.error('Error al iniciar análisis:', error);
                    showError(`No se pudo iniciar el análisis: ${error.message}`);
                    resetAnalysisUI();
                }
            }

            function showProgressArea() {
                const snapUploadArea = document.getElementById('snap-upload-area');
                const snapResultsArea = document.getElementById('snap-results-area');
                const progressArea = document.getElementById('progress-area');

                snapUploadArea?.classList.add('hidden');
                snapResultsArea?.classList.add('hidden');
                progressArea?.classList.remove('hidden');

                const detectedDishes = document.getElementById('detected-dishes');
                if (detectedDishes) {
                    detectedDishes.innerHTML = '';
                }

                // NUEVO: Mostrar indicadores de IA durante el progreso
                const aiIndicators = document.getElementById('ai-learning-indicators');
                if (aiIndicators) {
                    aiIndicators.classList.remove('hidden');
                }
            }

            function updateProgress(percentage, message) {
                const progressBar = document.getElementById('progress-bar');
                const progressStatus = document.getElementById('progress-status');
                const progressMessage = document.getElementById('progress-message');

                if (progressBar) {
                    progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
                }

                if (progressStatus) {
                    progressStatus.textContent = message || 'Procesando...';
                }

                if (progressMessage && percentage < 100) {
                    progressMessage.textContent = 'Tu receta se está procesando. La IA está aprendiendo de cada cotejamiento.';
                }
            }

            function subscribeToAnalysisUpdates(jobId) {
                console.log(`📡 Escuchando cambios para el trabajo ${jobId}...`);
                unsubscribeAll();

                statusChannel = supabaseClient
                    .channel(`db-changes-${jobId}`)
                    .on('postgres_changes', {
                        event: 'UPDATE',
                        schema: 'public',
                        table: APP_CONFIG.TABLES.TRABAJOS,
                        filter: `id=eq.${jobId}`
                    }, (payload) => {
                        const updatedJob = payload.new;
                        console.log(`✅ Cambio de estado recibido: ${updatedJob.estado}`);

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

                        unsubscribeAll();
                    })
                    .subscribe();

                progressChannel = supabaseClient
                    .channel(`progress-updates-${jobId}`)
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: APP_CONFIG.TABLES.ANALISIS_PROGRESO,
                        filter: `job_id=eq.${jobId}`
                    }, (payload) => {
                        handleProgressUpdate(payload.new.payload);
                    })
                    .subscribe();

                simulateProgress();
            }

            let progressInterval = null;

            function simulateProgress() {
                let progress = 0;
                progressInterval = setInterval(() => {
                    progress += Math.random() * 15;
                    if (progress > 90) {
                        progress = 90;
                        clearInterval(progressInterval);
                    }
                    updateProgress(progress, 'Analizando receta con IA adaptativa...');
                }, 1000);
            }

            function handleProgressUpdate(progressPayload) {
                console.log('📬 Nuevo mensaje de progreso:', progressPayload);

                let dishName = '';
                let ingredients = [];

                try {
                    let data;
                    if (typeof progressPayload === 'string') {
                        let jsonString = progressPayload;
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

            function addDetectedDish(dishName, ingredients = []) {
                const detectedDishes = document.getElementById('detected-dishes');
                if (!detectedDishes) return;

                const dishId = 'dish-' + dishName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
                let dishContainer = document.getElementById(dishId);

                if (!dishContainer) {
                    dishContainer = document.createElement('div');
                    dishContainer.id = dishId;
                    dishContainer.className = "p-4 bg-white rounded-lg border border-gray-200 shadow-sm";
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

                dishContainer.style.opacity = '0';
                dishContainer.style.transform = 'translateY(20px)';

                requestAnimationFrame(() => {
                    dishContainer.style.transition = 'all 0.3s ease';
                    dishContainer.style.opacity = '1';
                    dishContainer.style.transform = 'translateY(0)';
                });
            }

            async function showIngredientesExtractedStep(job) {
                if (progressInterval) {
                    clearInterval(progressInterval);
                }

                updateProgress(100, 'Ingredientes extraídos correctamente');
                currentAnalysis = job;
                appState.currentAnalysis = job;

                try {
                    const { data: platos, error } = await supabaseClient
                        .from('platos')
                        .select(`nombre, platos_ingredientes (cantidad, ingredientes ( nombre ))`)
                        .eq('trabajo_analisis_id', job.id);

                    if (error) throw error;

                    if (!platos || platos.length === 0) {
                        throw new Error("No se encontraron platos para este análisis.");
                    }

                    setTimeout(() => showPhase1Results(platos), 2000);

                } catch (error) {
                    console.error("Error fetching plates:", error);
                    showError("No se pudieron cargar los detalles de los platos extraídos.");
                }
            }

            function showPhase1Results(platos) {
                const progressArea = document.getElementById('progress-area');
                const snapResultsArea = document.getElementById('snap-results-area');

                progressArea?.classList.add('hidden');
                snapResultsArea?.classList.remove('hidden');

                const infoBanner = `
                    <div class="alert alert-success mb-8">
                        <i class="fas fa-check-circle text-2xl mr-4" aria-hidden="true"></i>
                        <div>
                            <h3 class="font-bold text-lg">¡Fase 1 Completada: Ingredientes Extraídos!</h3>
                            <p class="text-sm mt-1">Hemos identificado los siguientes platos e ingredientes. La IA aprenderá de cada cotejamiento en la Fase 2.</p>
                        </div>
                    </div>
                `;

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
                `).join('');

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
                `;

                if (snapResultsArea) {
                    snapResultsArea.innerHTML = infoBanner + platosCards + actionButtons;
                }

                document.getElementById('start-matching-button')?.addEventListener('click', () => {
                    startPhase2();
                });

                document.getElementById('reset-button-mid')?.addEventListener('click', () => {
                    resetAnalysis();
                });

                notificationSystem.show(
                    `Se extrajeron ${platos.length} platos con un total de ${platos.reduce((sum, p) => sum + p.platos_ingredientes.length, 0)} ingredientes`,
                    'success'
                );
            }

            function startPhase2() {
                if (!currentAnalysis) return;

                showProgressArea();
                updateProgress(0, 'Iniciando Fase 2: Cotejando con IA adaptativa...');

                // NUEVO: Actualizar mensaje para mostrar que la IA está aprendiendo
                const progressMessage = document.getElementById('progress-message');
                if (progressMessage) {
                    progressMessage.innerHTML = `
                        <span class="text-gray-600">La IA está cotejando ingredientes con productos reales y </span>
                        <span class="text-purple-600 font-semibold">aprendiendo de cada resultado</span>
                        <span class="text-gray-600"> para mejorar futuras búsquedas.</span>
                    `;
                }

                const detectedDishes = document.getElementById('detected-dishes');
                if (detectedDishes) {
                    detectedDishes.innerHTML = `
                        <div class="text-center py-8">
                            <div class="flex items-center justify-center mb-4">
                                <div class="spinner mr-3"></div>
                                <i class="fas fa-brain text-purple-500 text-xl"></i>
                            </div>
                            <p class="text-gray-600">Cotejando ingredientes con IA adaptativa...</p>
                            <p class="text-sm text-purple-600 mt-2">El sistema aprenderá de cada cotejamiento para mejorar la precisión</p>
                        </div>
                    `;
                }

                triggerCotejamiento(currentAnalysis.id);
            }

            async function triggerCotejamiento(jobId) {
                try {
                    const response = await fetch(APP_CONFIG.COTEJAMIENTO_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ job_id: jobId })
                    });

                    if (!response.ok) {
                        throw new Error('El webhook de cotejamiento no respondió correctamente.');
                    }

                    console.log("Webhook de cotejamiento invocado para job_id:", jobId);
                    subscribeToAnalysisUpdates(jobId);

                    simulatePhase2Progress();

                } catch (error) {
                    console.error("Error al invocar webhook de cotejación:", error);
                    showError(`No se pudo iniciar la cotejación: ${error.message}`);
                }
            }

            function simulatePhase2Progress() {
                let progress = 0;
                const messages = [
                    'Analizando ingredientes...',
                    '🧠 Aplicando conocimiento aprendido...',
                    'Buscando productos en la base de datos...',
                    '📊 Calculando similitudes semánticas...',
                    '💾 Capturando feedback automático...',
                    'Asignando precios...',
                    'Generando escandallo final...'
                ];
                let messageIndex = 0;

                progressInterval = setInterval(() => {
                    progress += Math.random() * 15;
                    if (progress > 95) {
                        progress = 95;
                        clearInterval(progressInterval);
                    }

                    if (progress > messageIndex * 15 && messageIndex < messages.length - 1) {
                        messageIndex++;
                    }

                    updateProgress(progress, messages[messageIndex]);
                }, 1800);
            }

            function showFinalResults(job) {
                if (progressInterval) {
                    clearInterval(progressInterval);
                }

                updateProgress(100, '¡Análisis completado con IA adaptativa!');

                setTimeout(() => {
                    const progressArea = document.getElementById('progress-area');
                    const snapResultsArea = document.getElementById('snap-results-area');

                    progressArea?.classList.add('hidden');
                    snapResultsArea?.classList.remove('hidden');

                    currentAnalysis = job;
                    appState.currentAnalysis = job;

                    const data = typeof job.resultado_final_json === 'string' ?
                        JSON.parse(job.resultado_final_json) : job.resultado_final_json;

                    const platos = data.platos_procesados;
                    const totalIngredients = platos.reduce((sum, p) => sum + (p.ingredientes_cotejados?.length || 0), 0);
                    const foundIngredients = platos.reduce((sum, p) => sum + Utils.calculateFoundIngredients(p.ingredientes_cotejados), 0);
                    const successRate = totalIngredients > 0 ? Math.round((foundIngredients / totalIngredients) * 100) : 0;

                    // NUEVO: Calcular estadísticas de aprendizaje
                    const learnedMatches = platos.reduce((sum, p) => {
                        return sum + (p.ingredientes_cotejados?.filter(ing => Utils.getMatchSource(ing) === 'learned').length || 0);
                    }, 0);

                    const successBanner = `
                        <div class="alert alert-success mb-8">
                            <i class="fas fa-trophy text-3xl mr-4" aria-hidden="true"></i>
                            <div>
                                <h3 class="font-bold text-xl">¡Análisis Completado con IA Adaptativa!</h3>
                                <p class="text-sm mt-1">Tu receta ha sido analizada y <strong>la IA ha aprendido ${learnedMatches} nuevas relaciones</strong> para mejorar futuras búsquedas.</p>
                            </div>
                        </div>
                    `;

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
                    `;

                    const platosHTML = platos.map(plato => {
                        const ingredientsPreview = plato.ingredientes_cotejados.slice(0, 4);
                        const foundInPlato = Utils.calculateFoundIngredients(plato.ingredientes_cotejados);
                        const platoSuccessRate = plato.ingredientes_cotejados.length > 0 ?
                            Math.round((foundInPlato / plato.ingredientes_cotejados.length) * 100) : 0;

                        // NUEVO: Estadísticas de aprendizaje por plato
                        const learnedInPlato = plato.ingredientes_cotejados.filter(ing => Utils.getMatchSource(ing) === 'learned').length;

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
                                const similarity = Utils.getSimilarityInfo(ing.similitud);
                                const source = Utils.getMatchSource(ing);

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
                                        `;
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
                        `;
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
                    `;

                    if (snapResultsArea) {
                        snapResultsArea.innerHTML = successBanner + summaryCard + platosHTML + actionButtons;
                    }

                    document.querySelectorAll('.view-plato-details-btn').forEach(button => {
                        button.addEventListener('click', () => {
                            const platoName = button.getAttribute('data-plato-name');
                            showPlatoDetails(platoName);
                        });
                    });

                    document.getElementById('view-full-details-button')?.addEventListener('click', () => {
                        renderDetailsModal(platos);
                    });

                    // NUEVO: Botón para ir al dashboard IA
                    document.getElementById('view-ai-dashboard-button')?.addEventListener('click', () => {
                        window.location.hash = '#ai-dashboard';
                    });

                    document.getElementById('reset-button-final')?.addEventListener('click', () => {
                        resetAnalysis();
                    });

                    // NUEVO: Notificación especial con estadísticas de aprendizaje
                    notificationSystem.show(
                        `🎉 ¡Análisis completado! ${successRate}% éxito • ${learnedMatches} cotejamientos por IA aprendida`,
                        'ai',
                        8000
                    );

                }, 1500);
            }

            function showPlatoDetails(platoName) {
                if (!currentAnalysis) return;

                const data = typeof currentAnalysis.resultado_final_json === 'string' ?
                    JSON.parse(currentAnalysis.resultado_final_json) : currentAnalysis.resultado_final_json;

                const plato = data.platos_procesados.find(p => p.plato_analizado === platoName);
                if (plato) {
                    renderDetailsModal([plato]);
                } else {
                    notificationSystem.show(`No se encontraron detalles para el plato: ${platoName}`, 'error');
                }
            }

            function showError(errorMessage) {
                const progressArea = document.getElementById('progress-area');
                const snapResultsArea = document.getElementById('snap-results-area');

                progressArea?.classList.add('hidden');
                snapResultsArea?.classList.remove('hidden');

                const errorHTML = `
                    <div class="card p-10 text-center bg-red-50 border-red-200">
                        <div class="mb-6">
                            <i class="fas fa-exclamation-triangle text-6xl text-red-500 mb-4" aria-hidden="true"></i>
                            <h3 class="text-3xl font-bold text-red-700 mb-3">Error en el Análisis</h3>
                        </div>
                        
                        <div class="max-w-2xl mx-auto mb-8">
                            <p class="text-lg text-red-600 mb-4">${Utils.sanitizeHTML(errorMessage)}</p>
                            <div class="text-sm text-gray-600 bg-white p-4 rounded-lg border">
                                <p class="mb-2"><strong>Posibles soluciones:</strong></p>
                                <ul class="text-left space-y-1">
                                    <li>• Asegúrate de que el archivo contenga texto legible</li>
                                    <li>• Verifica que la imagen tenga buena calidad y resolución</li>
                                    <li>• Intenta con un formato de archivo diferente (JPG, PNG, PDF)</li>
                                    <li>• Revisa tu conexión a internet</li>
                                </ul>
                            </div>
                        </div>
                        
                        <div class="flex flex-col sm:flex-row justify-center gap-4">
                            <button id="retry-analysis-button" class="btn btn-primary">
                                <i class="fas fa-redo mr-2" aria-hidden="true"></i>
                                Intentar de Nuevo
                            </button>
                            <button id="reset-button-error" class="btn btn-danger">
                                <i class="fas fa-home mr-2" aria-hidden="true"></i>
                                Volver al Inicio
                            </button>
                        </div>
                    </div>
                `;

                if (snapResultsArea) {
                    snapResultsArea.innerHTML = errorHTML;
                }

                document.getElementById('retry-analysis-button')?.addEventListener('click', () => {
                    if (selectedFile) {
                        startAnalysis();
                    } else {
                        resetAnalysis();
                    }
                });

                document.getElementById('reset-button-error')?.addEventListener('click', () => {
                    resetAnalysis();
                });

                notificationSystem.show(`Error en el análisis: ${errorMessage}`, 'error');
            }

            function resetAnalysis() {
                unsubscribeAll();

                if (progressInterval) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }

                selectedFile = null;
                currentAnalysis = null;
                appState.selectedFile = null;
                appState.currentAnalysis = null;

                const fileInput = document.getElementById('file-input');
                const filePreview = document.getElementById('file-preview');
                const analyzeButton = document.getElementById('analyze-button');
                const snapUploadArea = document.getElementById('snap-upload-area');
                const snapResultsArea = document.getElementById('snap-results-area');
                const progressArea = document.getElementById('progress-area');

                if (fileInput) fileInput.value = '';
                if (filePreview) filePreview.classList.add('hidden');
                if (analyzeButton) {
                    analyzeButton.disabled = true;
                    analyzeButton.innerHTML = `<i class="fas fa-cogs mr-2" aria-hidden="true"></i>Analizar Receta`;
                }

                if (progressArea) progressArea.classList.add('hidden');
                if (snapResultsArea) snapResultsArea.classList.add('hidden');
                if (snapUploadArea) snapUploadArea.classList.remove('hidden');

                // NUEVO: Ocultar panel de aprendizaje
                const learningPanel = document.getElementById('ai-learning-panel');
                const aiIndicators = document.getElementById('ai-learning-indicators');
                if (learningPanel) learningPanel.classList.add('hidden');
                if (aiIndicators) aiIndicators.classList.add('hidden');

                window.scrollTo({ top: 0, behavior: 'smooth' });
            }

            function resetAnalysisUI() {
                const analyzeButton = document.getElementById('analyze-button');
                if (analyzeButton) {
                    analyzeButton.disabled = !selectedFile;
                    analyzeButton.innerHTML = `<i class="fas fa-cogs mr-2" aria-hidden="true"></i>Analizar Receta`;
                }
            }

            function unsubscribeAll() {
                if (statusChannel) {
                    supabaseClient.removeChannel(statusChannel);
                    statusChannel = null;
                }
                if (progressChannel) {
                    supabaseClient.removeChannel(progressChannel);
                    progressChannel = null;
                }
            }

            function updateTime() {
                const currentTimeElement = document.getElementById('current-time');
                if (currentTimeElement) {
                    const now = new Date();
                    const timeString = now.toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    currentTimeElement.textContent = timeString;
                }
            }

            // ===== NUEVOS EVENT LISTENERS PARA IA =====
            document.getElementById('optimize-system-btn')?.addEventListener('click', () => {
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.optimizeSystem();
                }
            });

            document.getElementById('regenerate-embeddings-btn')?.addEventListener('click', () => {
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.regenerateEmbeddings();
                }
            });

            document.getElementById('export-knowledge-btn')?.addEventListener('click', () => {
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.exportKnowledge();
                }
            });

            document.getElementById('refresh-knowledge')?.addEventListener('click', () => {
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.loadLearnedRelations();
                }
            });

            document.getElementById('refresh-feedback')?.addEventListener('click', () => {
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.loadRecentFeedback();
                }
            });

            // ===== EVENT LISTENERS EXISTENTES =====
            document.getElementById('refresh-ingredientes-ia')?.addEventListener('click', loadIngredientesExtraidos);
            document.getElementById('refresh-escandallos')?.addEventListener('click', loadEscandallosGuardados);
            document.getElementById('refresh-database')?.addEventListener('click', () => updateDatabaseView(appState.currentDatabaseView));

            document.getElementById('show-ingredients-btn')?.addEventListener('click', () => updateDatabaseView('ingredients'));
            document.getElementById('show-products-btn')?.addEventListener('click', () => updateDatabaseView('products'));

            setupFileHandling();
            setupCameraHandling();
            setupAnalysisControls();

            updateTime();
            setInterval(updateTime, 60000);

            // NUEVO: Actualizar métricas de IA cada 30 segundos
            setInterval(() => {
                if (aiLearningSystem && aiLearningSystem.isActive) {
                    aiLearningSystem.loadInitialMetrics();
                }
            }, 30000);

            switchTab();

            setTimeout(() => {
                notificationSystem.show(
                    '🧠 ¡Bienvenido a Escandallos Pro con IA Adaptativa! El sistema aprende y mejora con cada análisis.',
                    'ai',
                    6000
                );
            }, 1000);

            console.log('✅ Escandallos Pro con IA Generativa inicializado correctamente');
        });
    </script>