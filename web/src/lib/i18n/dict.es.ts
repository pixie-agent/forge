import type { DictKey } from './dict.zh'

/**
 * Diccionario de español. Refleja `dict.zh.ts` clave por clave; el tipo de abajo
 * convierte una clave que falte en un error de compilación, así que ninguna cadena
 * puede publicarse sin traducir por accidente.
 */
export const es: Record<DictKey, string> = {
  // ---------- común ----------
  'common.loading': 'Cargando…',
  'common.copy': 'Copiar',
  'common.copied': 'Copiado ✓',
  'common.delete': 'Eliminar',
  'common.cancel': 'Cancelar',
  'common.confirm': 'Confirmar',
  'common.save': 'Guardar',
  'common.saving': 'Guardando…',
  'common.close': 'Cerrar',
  'common.retry': 'Reintentar',
  'common.open': 'Abrir',
  'common.refresh': 'Actualizar',
  'common.empty': '—',
  'common.unknown': 'Desconocido',
  'common.yes': 'Sí',
  'common.no': 'No',
  'common.search': 'Buscar',
  'common.language': 'Idioma',
  'common.version': 'Versión',
  'common.more': 'Más acciones',

  // ---------- tema / entorno ----------
  'theme.toLight': 'Cambiar al tema claro',
  'theme.toDark': 'Cambiar al tema oscuro',
  'theme.toggle': 'Alternar tema',
  'env.stagingHint':
    'Este es un entorno de staging: los datos y los artefactos están totalmente aislados de producción',

  // ---------- barra superior ----------
  'topbar.credits': 'Créditos',
  'topbar.logout': 'Cerrar sesión',
  'topbar.account': 'Cuenta',

  // ---------- portada ----------
  'landing.enterWorkspace': 'Abrir espacio de trabajo',
  'landing.loginOrRegister': 'Iniciar sesión / Registrarse',
  'landing.heroPrefix': 'Forgea tu idea en',
  'landing.heroSep': ' ',
  'landing.heroHighlight': 'una web lista para publicar',
  'landing.subtitle':
    'Describe lo que quieres. La IA lo planifica y lo programa, y al momento tendrás una página real y funcionando que puedes publicar y compartir.',
  'landing.placeholder':
    'p. ej. Una web para una panadería de barrio, con sus panes estrella, precios y reservas…',
  'landing.creditHint': '{cost} crédito por generación · {signup} créditos gratis al registrarte',
  'landing.start': 'Empezar a generar',
  'landing.creating': 'Creando…',
  'landing.example1': 'Cafetería de especialidad',
  'landing.example2': 'Portafolio personal',
  'landing.example3': 'Página de aterrizaje de un producto SaaS',
  'landing.example4': 'Blog de recetas caseras',
  'landing.example5': 'Servicio de hospedaje para mascotas',
  'landing.example6': 'Estudio de organización de bodas',
  'landing.showcaseTitle': 'Ejemplos destacados',
  'landing.showcaseSubtitle':
    'Webs creadas con Forge. Abre una o clónala y hazla tuya.',
  'landing.showcaseClone': 'Clonar',
  'landing.showcaseCloning': 'Clonando…',

  // ---------- inicio de sesión ----------
  'login.login': 'Iniciar sesión',
  'login.register': 'Crear cuenta',
  'login.registerWithCredits': 'Crear cuenta ({credits} créditos tras la verificación)',
  'login.continueIdea': 'Continúa tras iniciar sesión: {idea}',
  'login.continueClone':
    'El ejemplo seleccionado se clonará al iniciar sesión, y luego podrás seguir iterando',
  'login.withGoogle': 'Continuar con Google',
  'login.or': 'o',
  'login.email': 'Correo electrónico',
  'login.password': 'Contraseña (al menos 6 caracteres)',
  'login.submitting': 'Enviando…',
  'login.mergeHint':
    'Iniciar sesión con Google y con contraseña usando el mismo correo te da una sola cuenta',
  'login.checkEmailTitle': 'Verifica tu correo',
  'login.checkEmailBody':
    'Enviamos un correo de verificación a {email}. Haz clic en el enlace de ese correo para terminar; iniciarás sesión automáticamente y recibirás {credits} créditos.',
  'login.checkEmailFailed':
    'Tu cuenta se creó, pero no se pudo enviar el correo de verificación. Haz clic en «Reenviar correo de verificación» abajo para intentarlo otra vez.',
  'login.resend': 'Reenviar correo de verificación',
  'login.resending': 'Enviando…',
  'login.resendSent':
    'Si ese correo existe y todavía no está verificado, hemos enviado un nuevo correo de verificación. Revisa tu bandeja de entrada y la carpeta de spam.',
  'login.backToLogin': 'Volver al inicio de sesión',
  'login.verifyHint':
    '¿No lo has recibido? Revisa la carpeta de spam o reenvía el correo de verificación en un momento.',
  'verify.checking': 'Verificando tu correo…',
  'verify.success': 'Verificado. Redirigiendo…',
  'verify.failedTitle': 'La verificación ha fallado',
  'verify.goLogin': 'Vuelve al inicio de sesión para reenviarlo',

  // ---------- cuenta ----------
  'account.title': 'Ajustes de la cuenta',
  'account.email': 'Correo electrónico',
  'account.setTitle': 'Definir una contraseña',
  'account.changeTitle': 'Cambiar la contraseña',
  'account.googleHint':
    'Inicias sesión con Google y todavía no tienes contraseña. Define una para poder entrar también con tu correo y contraseña en la misma cuenta.',
  'account.current': 'Contraseña actual',
  'account.new': 'Nueva contraseña (al menos 6 caracteres)',
  'account.confirm': 'Confirma la nueva contraseña',
  'account.set': 'Definir contraseña',
  'account.change': 'Cambiar contraseña',
  'account.saved':
    'Contraseña actualizada. Los demás dispositivos deberán iniciar sesión de nuevo.',
  'account.saveFailed': 'No se ha podido actualizar la contraseña',
  'account.tooShort': 'La nueva contraseña debe tener al menos 6 caracteres',
  'account.mismatch': 'Las dos contraseñas nuevas no coinciden',
  'account.sessionHint':
    'Al cambiar tu contraseña, esta cuenta cerrará sesión en los demás dispositivos.',

  // ---------- proyectos ----------
  'projects.title': 'Mis proyectos',
  'projects.new': 'Nuevo proyecto',
  'projects.empty':
    'Todavía no hay proyectos. Describe una idea en la página de inicio para crear uno.',
  'projects.untitled': 'Proyecto sin título',
  'projects.published': 'Publicado',
  'projects.draft': 'Borrador',
  'projects.noDescription': 'Sin descripción',
  'projects.draftNoVersion': 'Borrador (sin versión todavía)',
  'projects.notGenerated': 'Todavía sin generar',
  'projects.publish': 'Publicar',
  'projects.publishing': 'Publicando…',
  'projects.unpublish': 'Despublicar',
  'projects.draftHint':
    'Tienes un borrador sin versión: ábrelo para crear una versión y publicarla',
  'projects.emptyHint':
    'Todavía sin generar: ábrelo y describe tu idea para crear la app',
  'projects.confirmDelete':
    'La eliminación no se puede deshacer. ¿Eliminar este proyecto?',
  'projects.confirmUnpublish':
    'El enlace público dejará de funcionar de inmediato (404). Las versiones y los datos se conservan y puedes publicar otra vez cuando quieras. ¿Despublicar?',

  // ---------- facturación / recarga ----------
  'billing.title': 'Créditos y facturación',
  'billing.balance': 'Créditos actuales',
  'billing.balanceHint':
    '{cost} crédito por generación; se devuelve automáticamente si la ejecución falla o la detienes.',
  'billing.comingSoon':
    'Estamos conectando los pagos: consulta ya los precios, el pago se abrirá pronto.',
  'billing.packs': 'Paquetes de créditos',
  'billing.packsHint':
    'Compra única. Los créditos nunca caducan: recarga cuando los necesites.',
  'billing.subscribe': 'Suscripción',
  'billing.subscribeHint':
    'Facturación mensual, créditos añadidos cada mes, cancela cuando quieras.',
  'billing.creditsAmount': '{credits} créditos',
  'billing.perMonth': '{credits} créditos / mes',
  'billing.perMonthSuffix': ' / mes',
  'billing.buy': 'Comprar',
  'billing.subscribeAction': 'Suscribirse',
  'billing.generationsHint': 'unas {count} generaciones',
  'billing.badge.popular': 'El más popular',
  'billing.badge.bestValue': 'Mejor precio',
  'billing.checkoutNotReady': 'El pago todavía no está disponible: te avisamos pronto',
  'billing.checkoutSuccess':
    'Pago recibido. Los créditos suelen llegar en unos segundos: actualiza la página si aún no los ves.',
  'billing.morNotice':
    'Los pagos, las facturas y los impuestos los gestiona Creem (Merchant of Record): en el extracto de tu tarjeta aparecerá Creem en lugar de este sitio, y los reembolsos los tramita Creem.',
  'billing.creditsNotice':
    'Los créditos solo se pueden usar dentro de este producto: no son retirables ni transferibles.',
  'billing.ledger': 'Historial de créditos',
  'billing.ledgerEmpty': 'Todavía no hay movimientos de créditos.',
  'billing.orders': 'Pedidos',
  'billing.ordersEmpty': 'Todavía no hay pedidos.',
  'billing.colTime': 'Fecha',
  'billing.colReason': 'Tipo',
  'billing.colDelta': 'Cambio',
  'billing.colBalance': 'Saldo',
  'billing.colNote': 'Nota',
  'billing.colAmount': 'Importe',
  'billing.colCredits': 'Créditos',
  'billing.colStatus': 'Estado',
  'billing.loadFailed': 'No se ha podido cargar, actualiza la página',
  'billing.reason.signup': 'Bono de registro',
  'billing.reason.job_hold': 'Cargo por generación',
  'billing.reason.job_release': 'Reembolso (falló / se detuvo)',
  'billing.reason.purchase': 'Recarga',
  'billing.reason.refund': 'Reembolso',
  'billing.reason.admin_grant': 'Concedido por el administrador',
  'billing.reason.expire': 'Caducados',
  'billing.status.pending': 'Pendiente',
  'billing.status.paid': 'Pagado',
  'billing.status.failed': 'Fallido',
  'billing.status.refunded': 'Reembolsado',

  // ---------- mensajes de error del servidor ----------
  'req.failed': 'La solicitud ha fallado ({status})',
  'req.network': 'Error de red, inténtalo de nuevo más tarde',
  'err.serverError': 'Error interno del servidor',
  'err.unauthorized': 'No autorizado',
  'err.notLoggedIn': 'No has iniciado sesión',
  'err.apiNotFound': 'Endpoint no encontrado',
  'err.methodNotAllowed': 'Método no permitido',
  'err.invalidBody': 'Cuerpo de la solicitud no válido',
  'err.invalidParams': 'Parámetros no válidos',
  'err.bodyMustBeJson': 'El cuerpo de la solicitud debe ser JSON',
  'err.bodyMustBeJsonObject': 'El cuerpo de la solicitud debe ser un objeto JSON',
  'err.bodyTooLarge': 'El cuerpo de la solicitud es demasiado grande',
  'err.tooFrequent': 'Demasiadas solicitudes, inténtalo de nuevo más tarde',
  'err.emailTaken': 'Este correo ya está registrado',
  'err.invalidEmail': 'Correo electrónico no válido',
  'err.passwordTooShort': 'La contraseña debe tener al menos 6 caracteres',
  'err.passwordTooLong': 'La contraseña es demasiado larga',
  'err.currentPasswordWrong': 'La contraseña actual no es correcta',
  'err.badCredentials': 'Correo o contraseña incorrectos',
  'err.emailNotVerified':
    'Correo no verificado. Revisa antes tu correo de verificación.',
  'err.verifyLinkInvalid':
    'Este enlace de verificación no es válido o ha caducado. Vuelve a enviarlo.',
  'err.verifyTooFrequent':
    'Se están enviando correos de verificación demasiado a menudo. Inténtalo de nuevo más tarde.',
  'err.verifySendFailed':
    'No se ha podido enviar el correo de verificación. Inténtalo de nuevo más tarde.',
  'err.userNotFound': 'Usuario no encontrado',
  'err.googleNotConfigured': 'El inicio de sesión con Google no está configurado',
  'err.insufficientCredits': 'No hay créditos suficientes para generar',
  'err.billingNotReady': 'El pago todavía no está disponible',
  'err.billingNotConfigured': 'La facturación no está configurada',
  'err.billingProductMissing': 'El producto no está configurado',
  'err.billingBadSignature': 'Firma de webhook no válida',
  'err.projectNotFound': 'Proyecto no encontrado',
  'err.cloneFailed': 'El clonado ha fallado, inténtalo de nuevo más tarde',
  'err.projectBusy':
    'Este proyecto ya tiene una generación en curso, espera un momento',
  'err.jobNotFound': 'Tarea no encontrada',
  'err.jobAlreadyDone': 'La tarea ya ha terminado, no hay nada que detener',
  'err.jobFinishedSendNormally': 'La tarea ha terminado, envía el mensaje con normalidad',
  'err.noActiveJob': 'Ahora mismo no hay ninguna tarea en curso',
  'err.ideaEmpty': 'Describe tu idea',
  'err.contentEmpty': 'El contenido no puede estar vacío',
  'err.generateFirst': 'Genera primero la app y después haz los cambios',
  'err.versionFirst': 'Crea una versión antes de publicar',
  'err.versionNotFound': 'Versión no encontrada',
  'err.publishVersionNotFound': 'La versión que quieres publicar no existe',
  'err.invalidVersionNo': 'Número de versión no válido',
  'err.noDraftToVersion': 'No hay ningún borrador que convertir en versión',
  'err.generationInProgress':
    'Hay una generación en curso, espera antes de crear una versión',
  'err.invalidAttachment': 'Adjunto no válido',
  'err.unknownConnector': 'Conector desconocido',
  'err.connectionNotFound': 'Conexión no encontrada',
  'err.connectorKekMissing':
    'CONNECTOR_KEK no está configurado, los conectores no están disponibles',
  'err.connectorNoSecretUpload': 'Este conector no admite subir credenciales',
  'err.connectorNoAuthNeeded':
    'Este conector no necesita autorización, solo rellena la configuración',
  'err.connectorNoSecretFields':
    'Este conector no define ningún campo de credencial',
  'err.noSecretToSave': 'No hay nada que guardar',
  'err.invalidKeyName': 'Nombre de clave no válido',
  'err.objectNotFound': 'Objeto no encontrado',
  'err.objectTooLarge': 'Objeto demasiado grande (límite de 2MB)',
  'err.recordNotFound': 'Registro no encontrado',
  'err.siteDataFull': 'Este sitio ha alcanzado su límite de datos',
  'err.invalidCollectionName': 'Nombre de colección no válido',
  'err.sqlEmpty': 'La consulta SQL no puede estar vacía',
  'err.sqlTooLong': 'La consulta SQL es demasiado larga',
  'err.invalidPath': 'Ruta no válida',
  'err.missingValue': 'Falta el valor',
  'err.valueMustBeJson': 'El valor debe ser JSON',
  'err.valueTooLarge': 'El valor es demasiado grande',

  // ---------- suscripción a la tarea ----------
  'job.progressLost':
    'Hemos perdido el seguimiento del progreso de la tarea. Actualiza la página más tarde para ver el resultado.',

  // ---------- adjuntos ----------
  'attach.tooMany': 'Puedes adjuntar como máximo {count} archivos',
  'attach.totalTooLarge': 'Los adjuntos no pueden superar {size} en total',
  'attach.readFailed': 'No se ha podido leer el archivo',
  'attach.rejectType':
    '{name}: solo se admiten imágenes ({imageExt}) y archivos de texto ({textExt})',
  'attach.rejectSize': '{name}: supera el límite de {kb}KB',
  'attach.rejectEmpty': '{name}: el archivo está vacío',
  'attach.fileReadError': '{name}: no se ha podido leer',
  'attach.pastedFileName': 'imagen-pegada-{ts}',
  'attach.marker': '📎 {count} adjunto(s): {names}',
  'attach.remove': 'Quitar {name}',
  'attach.add': 'Añadir adjunto',
  'attach.addTitle':
    'Añade imágenes o archivos de texto (hasta {count}: imágenes ≤{imageMB}MB, texto ≤{textKB}KB). También puedes pegar una imagen.',

  // ---------- panel de chat / proceso de generación ----------
  'chat.listSep': ', ',
  'chat.stage.planning': 'Planificando',
  'chat.stage.coding': 'Escribiendo la app',
  'chat.stage.modify': 'Editando el código',
  'chat.stage.building': 'Construyendo los artefactos',
  'chat.stage.active': 'en curso…',
  'chat.planningPrefix': 'Plan: {name}',
  'chat.processing': 'Trabajando',
  'chat.processTitle': 'Proceso de generación',
  'chat.elapsedSec': '{s}s transcurridos',
  'chat.elapsedMin': '{m}m {s}s transcurridos',
  'chat.elapsedHour': '{h}h {m}m transcurridos',
  'chat.collapse': 'Contraer ▾',
  'chat.features': 'Qué incluye esta entrega',
  'chat.jobFailed': 'Esta ejecución no ha terminado',
  'chat.jobFailedHint':
    'No se han descontado créditos. Reinténtalo o continúa desde el punto de control guardado si lo hay.',
  'chat.retry': 'Reintentar',
  'chat.resume': 'Continuar desde el punto de control',
  'chat.resumeHint': 'Último progreso guardado ({count} archivos)',
  'chat.stoppedTitle': 'Detenido',
  'chat.stoppedHint':
    'Tu progreso se ha guardado: continúa desde el punto de control en lugar de empezar de cero. No se han descontado créditos.',
  'chat.steerFailed': 'No se ha podido añadir la petición, inténtalo de nuevo',
  'chat.resizeAria': 'Arrastra para redimensionar el panel de chat',
  'chat.resizeTitle':
    'Arrastra para redimensionar el panel de chat; doble clic para restablecer',
  'chat.placeholderStreaming':
    'La generación está en curso: añade requisitos o pega una imagen y pulsa Intro para enviar…',
  'chat.placeholderGenerating': 'Generando…',
  'chat.placeholderIdle':
    'Describe tu idea o pide un cambio (puedes pegar una imagen)…',
  'chat.stop': 'Detener',
  'chat.stopping': 'Deteniendo…',
  'chat.stopTitle':
    'Detener esta ejecución: se conserva lo ya escrito para que puedas continuar desde el punto de control; no se descuentan créditos',
  'chat.send': 'Enviar',
  'chat.steer': 'Añadir',
  'chat.steerTitle': 'Añade este requisito a la tarea en curso',

  // ---------- espacio de trabajo (común) ----------
  'nav.chat': 'Chat',
  'nav.preview': 'Vista previa',
  'nav.code': 'Código',
  'nav.data': 'Datos',
  'env.test': 'Entorno de pruebas',
  'env.liveLabel': 'Entorno en vivo',
  'env.draftLabel': 'Borrador / entorno de pruebas',
  'env.draftShort': 'Borrador / pruebas',
  'env.testShort': 'Pruebas',
  'env.live': 'En vivo',

  // ---------- espacio de trabajo (avisos de página) ----------
  'ws.generateFailed': 'La generación ha fallado, inténtalo de nuevo',
  'ws.syncFailed':
    'No se ha podido sincronizar el resultado. Actualiza la página para ver la última versión.',
  'ws.stage.connecting': 'Conectando con el servicio de ejecución',
  'ws.stage.planning': 'Planificando el enfoque',
  'ws.stage.coding': 'Escribiendo el código de la app',
  'ws.stage.building': 'Construyendo los artefactos de la app',
  'ws.stage.chat': 'Aplicando los cambios que has pedido',
  'ws.conn.missing':
    '{name} está conectado, pero todavía falta rellenar «{fields}»: complétalo antes de generar',
  'ws.conn.writable':
    '{name} está conectado. Tiene acceso de escritura, desactivado por defecto: actívalo en la barra de chat para las ejecuciones que lo necesiten',
  'ws.conn.readonly':
    '{name} está conectado. Las próximas generaciones lo incluirán por defecto',
  'ws.conn.failed': 'Conexión no completada: {reason}',
  'ws.published': 'Publicada la v{version}. El enlace público está actualizado.',
  'ws.unpublished': 'Despublicado. El enlace público ya no funciona.',
  'ws.stopped': 'Esta ejecución se ha detenido (sin créditos descontados)',
  'ws.versionCommitted':
    'Creada la v{version}. Encuéntrala en el desplegable de versiones y publícala para ponerla en vivo.',
  'ws.confirmUnpublish':
    'Despublicar retira el enlace público de inmediato (404). Las versiones, el código y los datos se conservan y puedes republicar cuando quieras. ¿Despublicar?',
  'ws.attachmentDefault': 'Ten en cuenta los adjuntos que he subido',
  'ws.idleDraft':
    'Describe tu cambio; se aplicará al borrador (pulsa «Guardar versión» cuando esté listo)…',
  'ws.idleVersion':
    'Describe tu cambio; el borrador se actualizará a partir de la v{version}…',

  // ---------- vista previa ----------
  'preview.viewVersion': 'Ver versión',
  'preview.versionTitle':
    'Cambia qué borrador o versión estás viendo (solo vista: no cambia lo que está en vivo)',
  'preview.draftOption': 'Borrador · sin versión todavía',
  'preview.liveSuffix': ' (en vivo)',
  'preview.committing': 'Construyendo…',
  'preview.commitVersion': 'Guardar la versión v{version}',
  'preview.commitTitle':
    'Guarda el borrador actual como una versión; después podrás publicarla',
  'preview.device.desktop': 'Escritorio',
  'preview.device.mobile': 'Móvil',
  'preview.refresh': 'Actualizar vista previa',
  'preview.refreshTitle':
    'Recarga la vista previa; se actualiza sola cuando termina la generación: úsala si la página sigue mostrando contenido antiguo',
  'preview.publishTitle':
    'Publica la versión de trabajo actual (crea un enlace público que cualquiera puede abrir)',
  'preview.publishSwitchTitle':
    'Publica la v{version} directamente y cambia la versión en vivo; la versión de trabajo no se toca',
  'preview.switchLive': 'Poner la v{version} en vivo',
  'preview.publishVersion': 'Publicar la v{version}',
  'preview.helpTitle': 'Sobre las versiones',
  'preview.help.heading': 'Versiones y entrega',
  'preview.help.1':
    'La pestaña «Vista previa» muestra el **entorno de pruebas**: el contenido del borrador, totalmente aislado de la página pública en vivo (con datos aparte). Lleva una etiqueta de «entorno de pruebas» en la esquina.',
  'preview.help.2':
    'Generar y chatear escriben en el **borrador**; puedes iterar libremente. **No afecta al sitio en vivo ni crea una versión automáticamente**.',
  'preview.help.3':
    'Cuando esté todo bien, pulsa «Guardar la versión vN» para conservar el borrador como versión. Las versiones se guardan para siempre y nunca se sobrescriben entre sí; al chatear se continúa sobre la versión más reciente.',
  'preview.help.4':
    'El desplegable «Ver versión» solo cambia lo que estás **viendo** (no modifica nada).',
  'preview.help.5':
    '**Cambiar el sitio en vivo es una sola acción**: elige la versión en el desplegable → pulsa «Poner la vN en vivo». Usa la más reciente para avanzar o una anterior para volver atrás: la misma acción en ambos casos.',
  'preview.help.6':
    'Entrega: «↓ Descargar proyecto» en la pestaña de código exporta el código fuente completo de esa versión (zip, solo fuentes, sin datos) para ejecutarlo en local o guardarlo.',
  'preview.help.7':
    '«Despublicar» retira el enlace público de inmediato (las versiones y los datos se conservan; puedes republicar cuando quieras).',
  'preview.openTestTitle':
    'Abre el entorno de pruebas en una pestaña nueva: pruébalo en el móvil o a pantalla completa',
  'preview.copyTest': 'Copiar enlace de pruebas',
  'preview.copyTestTitle':
    'Copia el enlace del entorno de pruebas; quien lo abra verá el borrador (con la etiqueta «entorno de pruebas»), no el sitio en vivo',
  'preview.copyLive': 'Copiar enlace en vivo',
  'preview.openLiveTitle':
    'Abre la página en vivo {url} (cualquiera puede acceder a ella)',
  'preview.openExternal': 'Abrir ↗',
  'preview.unpublishTitle':
    'Despublicar elimina el enlace público de inmediato (las versiones y los datos se conservan)',
  'preview.liveNotPublished': 'En vivo · sin publicar',
  'preview.publishHint':
    'Guarda una versión y después pulsa «Publicar» para ponerla en vivo',
  'preview.draftBanner':
    'Esto es el borrador (sin versión todavía). Generar y chatear escriben aquí, así que puedes iterar libremente.',
  'preview.draftBanner2':
    'Cuando esté todo bien, pulsa «Guardar la versión v{version}» arriba a la derecha para conservarla como versión; solo una versión se puede publicar.',
  'preview.historyBanner':
    'Estás viendo la versión histórica v{view}; la más reciente es la v{latest}.',
  'preview.historyBanner2':
    'Al chatear se continúa sobre el borrador de la versión más reciente v{latest}; para poner la v{view} en vivo, pulsa «Poner la v{view} en vivo» arriba a la derecha.',
  'preview.generating': 'Generando tu app…',
  'preview.generatingHint':
    'Los artefactos se construyen solos cuando termina la generación; puedes salir de la página: la nube sigue trabajando',
  'preview.empty':
    'Todavía no hay vista previa: describe tu idea a la izquierda para empezar',

  // ---------- conectores (chips / panel / tarjeta) ----------
  'conn.title': 'Conectores',
  'conn.openTitle':
    'Conectores: conecta pagos, analítica, repos de código y más para que la web generada los use de verdad',
  'conn.chipsAddTitle':
    'Conecta un sistema externo (pagos, analítica, repos de código…) para que la web generada lo use de verdad',
  'conn.connectExternal': 'Conectar un sistema',
  'conn.none': 'Todavía no hay sistemas externos disponibles',
  'conn.writable': 'escritura',
  'conn.readonly': 'solo lectura',
  'conn.connected': 'conectado',
  'conn.manageAll':
    'Gestionar todos los conectores (cambiar de cuenta / desvincular / configuración por entorno)▸',
  'conn.chipLocked':
    'Esta ejecución ya ha empezado; los conectores se fijan al lanzarla y no pueden cambiar a mitad de la ejecución',
  'conn.chipOnTitle':
    '{name} está activo en esta ejecución ({kind}). Haz clic para desactivarlo (no se guarda; se restablece al terminar la ejecución).',
  'conn.chipOffTitle':
    '{name} no está activo en esta ejecución. Haz clic para activarlo en esta ejecución{hint}',
  'conn.chipWritableHint':
    ' (acceso de escritura: el agente te confirmará antes de actuar)',
  'conn.panelSubtitle':
    'Conecta sistemas externos para que el agente los use de verdad al generar (los de solo lectura se activan por defecto al vincularlos; los de escritura están desactivados por defecto: actívalos en la barra de chat cuando los necesites)',
  'conn.disabled':
    'Los conectores están desactivados{reason}. Configura `CONNECTOR_KEK` en el Worker para activarlos.',
  'conn.panelFooter':
    'Nota: una conexión vinculada al **entorno en vivo** surte efecto cuando un visitante abre la página pública: asegúrate de que es la cuenta que quieres (sobre todo para los pagos). Las claves que proporcionas se guardan cifradas, solo se usan para generar este proyecto, nunca se escriben en los artefactos del sitio y puedes desvincularlas o revocarlas aquí cuando quieras.',
  'conn.status.connected': 'Conectado · {label}',
  'conn.status.revoked': 'Autorización revocada',
  'conn.status.unauthorized': 'Sin autorizar',
  'conn.status.keySaved': 'Clave guardada · {label}',
  'conn.status.awaitKey': 'Clave pendiente',
  'conn.status.notConnected': 'Sin conectar',
  'conn.action.connect': 'Conectar',
  'conn.action.reconnect': 'Cambiar de cuenta',
  'conn.action.reconnectTitle': 'Autoriza otra vez con una cuenta distinta',
  'conn.action.reupload': 'Volver a subir',
  'conn.action.reuploadTitle':
    'Pega la clave otra vez (con el mismo nombre se sobrescribe la anterior; úsalo para rotar)',
  'conn.action.unbind': 'Desvincular',
  'conn.action.unbindTitle':
    'Desvincula solo de este proyecto; la conexión a nivel de cuenta se mantiene y los demás proyectos no se ven afectados',
  'conn.noOauthClient':
    'La plataforma no ha configurado un cliente OAuth para este conector',
  'conn.oauthJump': 'Ir a la página de autorización externa',
  'conn.redirectWarn':
    'Si la página de autorización indica `redirect_uri_mismatch`, esta dirección no está registrada en la consola externa (debe ser el **mismo cliente OAuth**, de tipo «Aplicación web», coincidencia carácter por carácter):',
  'conn.nameLabel': 'Nombre (opcional)',
  'conn.namePlaceholder': 'p. ej. Mi {provider} (pruebas / en vivo)',
  'conn.action.overwrite': 'Sobrescribir',
  'conn.action.saveBind': 'Guardar y vincular',
  'conn.action.reuseOption': 'Usar una clave existente…',
  'conn.action.reuseTitle':
    'Reutiliza una clave guardada en lugar de pegarla de nuevo',
  'conn.action.saveConfig': 'Guardar configuración',
  'conn.action.bind': 'Vincular',
  'conn.missing': 'Falta: {fields}',
  'conn.effective': 'Activo en este entorno',
  'conn.oauthUnavailable':
    'Vinculado, pero la autorización no es utilizable: haz clic en «Conectar» para autorizarla otra vez.',
  'conn.keyMissing':
    'Este proyecto no tiene ninguna clave utilizable vinculada en este entorno: pega una clave y guárdala.',
  'conn.field.secret': 'secreta',
  'conn.field.public': 'pública en la página',
  'conn.card.title': 'Conectar {provider}',
  'conn.card.reuseHint':
    'Tu cuenta ya tiene guardadas las credenciales de {provider}. Haz clic para conectarlas a este proyecto (sin volver a subir la clave{oauthNote}):',
  'conn.card.reuseOauthNote': ', sin volver a autorizar',
  'conn.card.reuseAction': 'Conectar ▸',
  'conn.card.fillFirst':
    'Rellena primero «{fields}» abajo y después haz clic en conectar',
  'conn.card.saveConnect': 'Guardar y conectar',
  'conn.card.bindTo': 'Conectar a',
  'conn.card.liveNote':
    'surte efecto cuando un visitante abre la página pública',
  'conn.card.oauthLeadNew': 'Este conector te pide',
  'conn.card.oauthLeadReuse': 'Si quieres cambiar de cuenta, puedes',
  'conn.card.oauthHint':
    ' autorizar tu propia cuenta de {provider}: salta a su página, haz clic en «Permitir» y se vinculará automáticamente al volver.',
  'conn.card.goAuthorize': 'Ir a la autorización',
  'conn.card.reauthorize': 'Autorizar otra cuenta de {provider}',
  'conn.card.fillBeforeAuth':
    'Rellena «{fields}» antes de autorizar para terminarlo todo de una vez',
  'conn.card.orPasteKey': 'O pega una clave nueva:',
  'conn.card.jobRunning':
    'Ya hay una ejecución en curso; los conectores se fijan al empezar: las credenciales guardadas aquí surtirán efecto a partir de la **siguiente** generación.',
  'conn.card.secretNote':
    'La clave solo se usa para llamar a {provider} durante la generación, se guarda cifrada, nunca se escribe en el código de tu sitio y nunca aparece en el historial del chat.',
  'conn.card.doneTitle': '{provider} conectado',
  'conn.card.doneBody':
    'Vinculado al {env}. Las credenciales se guardan cifradas y nunca aparecen en el chat, el código ni los artefactos. {tail}',
  'conn.card.doneTailWritable':
    'Tiene acceso de escritura, desactivado por defecto: activa su chip en la barra de chat para las ejecuciones que lo necesiten.',
  'conn.card.doneTailReadonly':
    'Las próximas generaciones lo incluirán por defecto.',

  // ---------- panel de datos ----------
  'data.env.draftHint':
    'Datos generados al interactuar con la vista previa del editor; no afectan al sitio en vivo',
  'data.env.liveHint':
    'Datos generados por los visitantes en la página pública tras la publicación',
  'data.kind.kv': 'Clave-valor',
  'data.kind.blob': 'Objetos',
  'data.sqlHint':
    'Se ejecuta en la base de datos SQLite aislada del entorno «{env}»; es independiente del otro entorno y de los demás proyectos',
  'data.jsonInvalid':
    'El valor debe ser JSON válido (envuelve las cadenas entre comillas)',
  'data.confirmDeleteKey': '¿Eliminar la clave «{key}»?',
  'data.keyNameInvalid':
    'Un nombre de clave solo puede contener letras, dígitos, puntos, guiones bajos y guiones (1–64 caracteres)',
  'data.newKey': '+ Nueva clave',
  'data.keyName': 'Nombre de la clave',
  'data.noKeys': 'Todavía no hay claves en este entorno',
  'data.saved': 'Guardado',
  'data.valuePlaceholder': 'Valor JSON, p. ej. {"count": 1} o "text"',
  'data.valueHint':
    'Los valores se guardan como JSON; para guardar texto plano, envuélvelo en comillas, p. ej. "hola"',
  'data.pickKey': 'Elige una clave a la izquierda para ver o editar su valor',
  'data.upload': '+ Subir objeto',
  'data.uploading': 'Subiendo…',
  'data.noObjects': 'Todavía no hay objetos en este entorno',
  'data.readFailed': 'No se ha podido leer ({status})',
  'data.uploadFailed': 'La subida ha fallado ({status})',
  'data.download': '↓ Descargar',
  'data.reading': 'Leyendo…',
  'data.noPreview':
    'Este tipo no se puede previsualizar aquí: haz clic en «Descargar» para verlo',
  'data.pickObject': 'Elige un objeto a la izquierda para verlo o descargarlo',
  'data.confirmDeleteObject': '¿Eliminar el objeto «{key}»?',
  'data.confirmDeleteRow': '¿Eliminar esta fila?',
  'data.rowCount': '{count} filas',
  'data.addRow': 'Añadir fila',
  'data.noRowid':
    'Esta tabla no tiene rowid, así que solo se puede consultar (sin edición ni borrado en línea)',
  'data.colRow': 'Fila',
  'data.colActions': 'Acciones',
  'data.newBadge': 'nuevo',
  'data.tableEmpty': 'Esta tabla todavía no tiene datos',
  'data.prevPage': 'Anterior',
  'data.nextPage': 'Siguiente',
  'data.schema': 'Esquema',
  'data.noTables': 'Todavía no hay tablas: escribe SQL para crear una',
  'data.loaded':
    'Se ha cargado la consulta de «{name}»; haz clic en «Ejecutar» para verla',
  'data.openInSql': 'Abrir en el editor SQL',
  'data.index': 'índice',
  'data.view': 'vista',
  'data.trigger': 'trigger',
  'data.tabTable': 'Datos de la tabla',
  'data.tabSql': 'Editor SQL',
  'data.sqlScope': 'Se ejecuta en el SQLite aislado del entorno «{env}»',
  'data.run': 'Ejecutar ⌘/Ctrl+↵',
  'data.running': 'Ejecutando…',
  'data.pickTable': 'Elige una tabla a la izquierda para ver y editar sus datos',
  'data.resultMeta':
    '{rows} fila(s) devueltas · {read} leídas · {written} escritas · {ms}ms',
  'data.okNoRows': 'Correcto (no se devolvieron filas)',
  'data.sqlTemplate':
    '-- Escribe aquí cualquier SQLite: crea tablas, índices, consultas\nCREATE TABLE IF NOT EXISTS notes (\n  id         INTEGER PRIMARY KEY AUTOINCREMENT,\n  title      TEXT NOT NULL,\n  done       INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))\n);\nCREATE INDEX IF NOT EXISTS idx_notes_done ON notes(done);\nINSERT INTO notes (title) VALUES (\'prueba a consultarme\');\nSELECT * FROM notes LIMIT 100;',

  // ---------- vista de código ----------
  'code.liveWriting': 'escribiendo en vivo',
  'code.files': 'Archivos',
  'code.downloadTitle':
    'Descarga el código fuente completo de esta versión (zip); ejecútalo en local con npm install && npm run build',
  'code.download': '↓ Descargar proyecto',
  'code.pickFile': 'Elige un archivo a la izquierda para verlo',
  'code.artifacts': 'Artefactos compilados',
  'code.artifactsMeta': 'entrada {entry} · {count} archivo(s) · {size} KB',
  'code.empty':
    'En cuanto empieza la generación, el código que escribe el agente aparece aquí en tiempo real',

  // ---------- precios públicos / pie / legal ----------
  'landing.pricingLink': 'Precios',
  'footer.pricing': 'Precios',
  'footer.terms': 'Términos del servicio',
  'footer.privacy': 'Política de privacidad',
  'footer.acceptableUse': 'Política de uso aceptable',
  'footer.support': 'Soporte',
  'footer.tagline': 'Convierte ideas en webs publicables con IA.',
  'footer.operator': 'Forge es operado por {entity} (nombre comercial: {business}).',
  'footer.rights': '© {year} {entity}. Todos los derechos reservados.',
  'pricing.title': 'Precios',
  'pricing.subtitle':
    'Los créditos se consumen por generación. Compra un paquete de créditos de una vez o suscríbete mensualmente. Todos los precios están en USD.',
  'pricing.included': 'Recibe {credits} créditos gratis al registrarte',
  'pricing.note':
    'El pago, la facturación, los impuestos y los reembolsos los gestiona Creem como Merchant of Record. En el extracto de tu tarjeta aparecerá Creem, no Forge.',
  'pricing.viewFull': 'Ver los precios completos',
  'pricing.cta': 'Regístrate gratis y empieza a construir',
  'pricing.loadFailed':
    'No se han podido cargar los precios. Inténtalo de nuevo más tarde.',
  'login.consentPrefix': 'Al crear una cuenta, aceptas nuestros',
  'login.consentAnd': 'y',
  'login.consentSuffix': '.',
  'legal.lastUpdated': 'Última actualización: 20 de octubre de 2026',
  'legal.backHome': 'Volver al inicio',
  'legal.contact':
    '¿Dudas sobre esta página? Escribe a {entity} en {email}. Sitio web: {url}.',
  'legal.operator':
    'Operador del servicio: {entity} (nombre comercial: {business}, {country}). Contacto: {email}.',
  'legal.fallbackNotice':
    'Este documento legal todavía no está disponible en tu idioma. El texto en inglés que aparece a continuación es el texto oficial.',
  'app.title': 'Forge — convierte tu idea en un sitio web en producción',
}
