# Catálogo de Categorías — GLPI ↔ Aranda

> Documento **generado automáticamente** por `scripts/build-catalog-doc.js` a partir de las dos fuentes autoritativas. No editar a mano: re-generar tras cambios en los CSV.

**Fecha de generación:** 2026-06-18
**Fuente GLPI:** `glpi_categories.csv` (export de `glpi_itilcategories`, árbol bajo **MDH**)
**Fuente Aranda:** `Libro1.utf8.csv` (export funcional, 2 niveles: Grupo → Sub Grupo, con código y tipo)

**Alineación:** GLPI 16 grupos / 77 subcategorías ↔ Aranda 16 grupos / 77 subcategorías. Cruce 1:1 por nombre normalizado (sin acentos, espacios colapsados, case-insensitive); 100% de cobertura verificada con `scripts/analyze-catalog-alignment.js`.

---

## 1. Catálogo GLPI (árbol ITIL)

Raíz: **MDH**. Cada subcategoría indica su visibilidad GLPI: **S** = Solicitud (`is_request`), **I** = Incidente (`is_incident`).

### 1.1 Problema al modificar la DUA posterior a la aceptación

| Subcategoría | Vis. |
|---|:--:|
| No permite modificar un campo | I |
| Permite modificar un campo, pero no se refleja el ajuste | I |

### 1.2 Problemas al Guardar / Almacenar

| Subcategoría | Vis. |
|---|:--:|
| Problemas al intentar guardar o recuperar borradores/versiones de la DUA | I |

### 1.3 Problemas Asociados a la Infraestructura IT (Oculta)

| Subcategoría | Vis. |
|---|:--:|
| Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC a nivel Infraestructura IT | I |

### 1.4 Problemas Asociados a la Selectividad

| Subcategoría | Vis. |
|---|:--:|
| Problema Técnico a la hora del crear una regla. (Los usuarios serán la DGR) | I |
| No se generó el Levante automático | I |
| No se visualiza el aforador asignado | I |
| Problemas con la notificación recibida por correo | I |
| Problemas con las observaciones | I |
| Problemas en el enrutamiento del DUA | I |
| Problemas en la reasignación de DUAs | I |
| Problemas técnicos por parte del aforador | S |
| Se detecta un problema en la regla o se requiere ajustar la regla. (Ej: Regla mal hecha, bajar la selectividad) | S |
| Dificultades relacionadas al proceso de impugnación sobre el aforo realizado | I |
| Problemas asociados a la selección o cargas de trabajo y asignación de aforador | I |

### 1.5 Problemas con el cálculo de la Liquidación

| Subcategoría | Vis. |
|---|:--:|
| Error en el cálculo de la liquidación | I |
| Se determina que el error esta en ATENA (endopint de API) | I |
| Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR | I |
| Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios sin actualizar | I |
| Se determina que el error esta en el API del cliente que generó el DUA, se insta a comunicarse con su proveedor | I |

### 1.6 Problemas con Llenado y Aceptación

| Subcategoría | Vis. |
|---|:--:|
| No existe claridad sobre el error que genera el sistema | I |
| El sistema no acepta la declaración o la acepta y no numera. | I |
| El sistema no permite editar el DUA después de haberlo guardado | I |
| Faltan opciones en un combo box | I |
| Consulta sobre llenado de un campo específico | S |

### 1.7 Problemas de Acceso

| Subcategoría | Vis. |
|---|:--:|
| No se puede ingresar a Atena (error de autenticación, plataforma no disponible). | I |
| Problemas con la asignación de perfiles | I |
| Problemas con el Perfil asignado | I |
| Autorización de cuentas de Usuario | S |
| Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo | S |
| Solicitud y asignación de Perfil de Acceso | S |
| La solicitud Implica Activación Usuario Contingencia Mesa valida que la solicitud venga con el documento de identidad adjunto por ambos lados. | S |
| La solicitud Implica Activación Usuario Contingencia DGA valorar si corresponde | S |
| La solicitud Implica Activación Usuario Contingencia DTIC Notifica al solicitante con el usuario y contraseña | S |

### 1.8 Problemas de Anotación de Salida

| Subcategoría | Vis. |
|---|:--:|
| El sistema no permite registrar la salida efectiva de la mercancía | I |
| En segmento Boletín de Liquidación no se genera el link para generar la anotación de salida | I |

### 1.9 Problemas de Asociación de Documentos LPCO

| Subcategoría | Vis. |
|---|:--:|
| Consultar sobre el tipo de documento LPCO requerido para una operación específica. | I |
| Error al intentar adjuntar, vincular o visualizar un documento LPCO. | I |
| Escalabilidad: Falla en la conexión de interoperabilidad de ATENA con el organismo emisor del LPCO. (Problemas endpoint) | I |
| Se detectan problemas de validación al asociar un LPCO | I |
| LPCO aprobado por organismo emisor pero no esta en ATENA | I |
| Problemas al solicitar un permiso en el módulo LPCO | I |
| Problemas en el módulo LPCO al aprobar un permiso (Usuario: DGT - Estadística y Registro o Aduanas) | I |
| Problemas en el módulo LPCO con el registro del permiso por parte del ente emisor. (Ejemplo Ministerio de Seguridad, OFINASE, que no usan ninguna plataforma) | I |
| Escalabilidad: Se determina problemas en la digitación del permiso aprobado en el módulo LPCO por parte del ente emisor. (Ejemplo Ministerio de Seguridad, OFINASE) | I |
| Escalabilidad: Se detecta que el problema de interoperabilidad esta del lado de las instituciones y no del Consorcio | I |
| Permiso solicitado en el módulo LPCO pendiente de aprobación por autoridad Aduanera | I |
| Escalabilidad: Se determina que documento de identidad no esta registrado en ATENA | I |
| Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC | I |

### 1.10 Problemas de Pago

| Subcategoría | Vis. |
|---|:--:|
| Problemas con el envío, respuesta o visualización del pago | I |
| Problemas de anulación del DUA | I |
| Problemas con la cuenta bancaria | I |
| Problemas para registrar la cuenta bancaria de un usuario en ATENA | I |
| Escalamiento: Requiere registrar la cuenta bancaria a un usuario | I |
| Escalamiento al Banco Central para validación técnica hasta conseguir la solución | I |
| Escalamiento al area Técnica del MdH para validar si los servicios de API REST "tesoro digital" (Ej: Web Banking, SINPE) esta operativo | I |

### 1.11 Problemas desarrollador API

| Subcategoría | Vis. |
|---|:--:|
| Falla en el metódo de autenticación o token API | I |
| Falla en la integración o problemas con el API | I |
| Consultas sobre documentación del API | S |

### 1.12 Consulta sobre el Manual de Procedimientos Aduaneros

| Subcategoría | Vis. |
|---|:--:|
| Consultas sobre el Manual de Procedimientos Aduaneros o Circulares, Directrices y Resoluciones recientes sobre ajustes al procedimiento en ATENA | S |
| Escalamiento solo cuando existen consultas sobre el manual de procedimientos aduaneros, LGA - Ley General de Aduanas, RLGA - Reglamento Ley General de Aduanas o novedades sobre Circulares o Directrices (> 1 semana) | S |

### 1.13 Problemas en el proceso de rectificacion

| Subcategoría | Vis. |
|---|:--:|
| Se están definiendo las politicas de rectificación, después de confirmación | I |

### 1.14 Problemas en la Firma Digital

| Subcategoría | Vis. |
|---|:--:|
| Problemas para firmar digitalmente en ATENA | I |
| Se detecta que el error es externo, se sensibiliza a contactar a su proveedor de firma digital | I |
| Escalamiento al area Técnica del MdH para validar si la plataforma "hacienda autentica" esta operativa | I |

### 1.15 Problemas en Proceso de Levante

| Subcategoría | Vis. |
|---|:--:|
| El sistema no genera la autorización de levante | I |
| Escalamiento: Se determina problema de interoperabilidad es de ATENA | I |
| Escalamiento: Se determina problema de interoperabilidad es del Puerto | I |

### 1.16 Problemas en Proceso de Tránsito

| Subcategoría | Vis. |
|---|:--:|
| Problemas al tratar de dar inicio o fin al tránsito, o no actualización del estado de la DUA | I |
| Problemas al tratar de modificar datos de tránsito | I |
| El sistema no generó el comprobante de movilización | I |
| El sistema no muestra la opción de Generar Tránsito (T1) | I |
| El sistema no permite realizar la operación de agrupar DUAS para generar un solo Tránsito (T1) | I |
| Imposibilidad de imprimir el comprobante de movilización | I |
| Problemas para revisar una incidencia en tránsito y actualización de los estados (Usuario: Aduana) | I |
| Imposibilidad de reportar incidencias en carretera Ejemplo: ocurrió el incidente y el usuario no sabe que hacer o no se le habilitó la funcionalidad de registrar incidencias | S |
| Incidencia pendiente de autorización por parte de la Aduana | I |

---

## 2. Catálogo Aranda

Modelo de 2 niveles. **Tipo** define el segmento del caso: Incidencia = segmento 1 (IM), Requerimiento = segmento 4 (RF).

### 2.1 Problema al modificar la DUA posterior a la aceptación (grupo 820)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 821 | Incidencia | No permite modificar un campo | Consorcio - Mesa de Servicio N1 |
| 822 | Incidencia | Permite modificar un campo, pero no se refleja el ajuste | Consorcio - Mesa de Servicio N1 |

### 2.2 Problemas al Guardar / Almacenar (grupo 823)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 824 | Incidencia | Problemas al intentar guardar o recuperar borradores/versiones de la DUA | Consorcio - Mesa de Servicio N1 |

### 2.3 Problemas Asociados a la Infraestructura IT (Oculta) (grupo 913)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 914 | Incidencia | Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC a nivel Infraestructura IT | Ministerio de Hacienda - DTIC |

### 2.4 Problemas Asociados a la Selectividad (grupo 825)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 827 | Incidencia | Problema Técnico a la hora del crear una regla. (Los usuarios serán la DGR) | Consorcio - Mesa de Servicio N1 |
| 829 | Incidencia | No se generó el Levante automático | Consorcio - Mesa de Servicio N1 |
| 830 | Incidencia | No se visualiza el aforador asignado | Consorcio - Mesa de Servicio N1 |
| 831 | Incidencia | Problemas con la notificación recibida por correo | Consorcio - Mesa de Servicio N1 |
| 832 | Incidencia | Problemas con las observaciones | Consorcio - Mesa de Servicio N1 |
| 833 | Incidencia | Problemas en el enrutamiento del DUA | Consorcio - Mesa de Servicio N1 |
| 834 | Incidencia | Problemas en la reasignación de DUAs | Consorcio - Mesa de Servicio N1 |
| 900 | Requerimiento | Problemas técnicos por parte del aforador | Consorcio - Mesa de Servicio N1 |
| 901 | Requerimiento | Se detecta un problema en la regla o se requiere ajustar la regla. (Ej: Regla mal hecha, bajar la selectividad) | Consorcio - Especialista N2 |
| 826 | Incidencia | Dificultades relacionadas al proceso de impugnación sobre el aforo realizado | Ministerio de Hacienda - DGA -DGT |
| 828 | Incidencia | Problemas asociados a la selección o cargas de trabajo y asignación de aforador | Ministerio de Hacienda - DGA -DGT |

### 2.5 Problemas con el cálculo de la Liquidación (grupo 835)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 836 | Incidencia | Error en el cálculo de la liquidación | Consorcio - Mesa de Servicio N1 |
| 838 | Incidencia | Se determina que el error esta en ATENA (endopint de API) | Consorcio - Mesa de Servicio N1 |
| 840 | Incidencia | Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR | Consorcio - Mesa de Servicio N1 |
| 837 | Incidencia | Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios sin actualizar | Ministerio de Hacienda - DGA -DGT |
| 839 | Incidencia | Se determina que el error esta en el API del cliente que generó el DUA, se insta a comunicarse con su proveedor | Ministerio de Hacienda - DTIC |

### 2.6 Problemas con Llenado y Aceptación (grupo 841)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 842 | Incidencia | No existe claridad sobre el error que genera el sistema | Consorcio - Mesa de Servicio N1 |
| 843 | Incidencia | El sistema no acepta la declaración o la acepta y no numera. | Consorcio - Mesa de Servicio N1 |
| 844 | Incidencia | El sistema no permite editar el DUA después de haberlo guardado | Consorcio - Mesa de Servicio N1 |
| 845 | Incidencia | Faltan opciones en un combo box | Consorcio - Mesa de Servicio N1 |
| 902 | Requerimiento | Consulta sobre llenado de un campo específico | Consorcio - Mesa de Servicio N1 |

### 2.7 Problemas de Acceso (grupo 846)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 847 | Incidencia | No se puede ingresar a Atena (error de autenticación, plataforma no disponible). | Consorcio - Mesa de Servicio N1 |
| 849 | Incidencia | Problemas con la asignación de perfiles | Consorcio - Mesa de Servicio N1 |
| 848 | Incidencia | Problemas con el Perfil asignado | Ministerio de Hacienda - DGA -DGT |
| 850 | Requerimiento | Autorización de cuentas de Usuario | Ministerio de Hacienda - DGA -DGT |
| 912 | Requerimiento | Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo | Ministerio de Hacienda - DTIC |
| 852 | Requerimiento | Solicitud y asignación de Perfil de Acceso | Consorcio - Mesa de Servicio N1 |
| 926 | Requerimiento | La solicitud Implica Activación Usuario Contingencia Mesa valida que la solicitud venga con el documento de identidad adjunto por ambos lados. | Consorcio - Mesa de Servicio N1 |
| 927 | Requerimiento | La solicitud Implica Activación Usuario Contingencia DGA valorar si corresponde | Ministerio de Hacienda - DGA -DGT |
| 928 | Requerimiento | La solicitud Implica Activación Usuario Contingencia DTIC Notifica al solicitante con el usuario y contraseña | Ministerio de Hacienda - DTIC |

### 2.8 Problemas de Anotación de Salida (grupo 853)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 854 | Incidencia | El sistema no permite registrar la salida efectiva de la mercancía | Consorcio - Mesa de Servicio N1 |
| 855 | Incidencia | En segmento Boletín de Liquidación no se genera el link para generar la anotación de salida | Consorcio - Mesa de Servicio N1 |

### 2.9 Problemas de Asociación de Documentos LPCO (grupo 856)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 857 | Incidencia | Consultar sobre el tipo de documento LPCO requerido para una operación específica. | Consorcio - Mesa de Servicio N1 |
| 858 | Incidencia | Error al intentar adjuntar, vincular o visualizar un documento LPCO. | Consorcio - Mesa de Servicio N1 |
| 859 | Incidencia | Escalabilidad: Falla en la conexión de interoperabilidad de ATENA con el organismo emisor del LPCO. (Problemas endpoint) | Consorcio - Mesa de Servicio N1 |
| 862 | Incidencia | Se detectan problemas de validación al asociar un LPCO | Consorcio - Mesa de Servicio N1 |
| 865 | Incidencia | LPCO aprobado por organismo emisor pero no esta en ATENA | Consorcio - Mesa de Servicio N1 |
| 866 | Incidencia | Problemas al solicitar un permiso en el módulo LPCO | Consorcio - Mesa de Servicio N1 |
| 867 | Incidencia | Problemas en el módulo LPCO al aprobar un permiso (Usuario: DGT - Estadística y Registro o Aduanas) | Consorcio - Mesa de Servicio N1 |
| 868 | Incidencia | Problemas en el módulo LPCO con el registro del permiso por parte del ente emisor. (Ejemplo Ministerio de Seguridad, OFINASE, que no usan ninguna plataforma) | Consorcio - Mesa de Servicio N1 |
| 863 | Incidencia | Escalabilidad: Se determina problemas en la digitación del permiso aprobado en el módulo LPCO por parte del ente emisor. (Ejemplo Ministerio de Seguridad, OFINASE) | Ministerio de Hacienda - DGA -DGT |
| 860 | Incidencia | Escalabilidad: Se detecta que el problema de interoperabilidad esta del lado de las instituciones y no del Consorcio | Ministerio de Hacienda - DGA -DGT |
| 861 | Incidencia | Permiso solicitado en el módulo LPCO pendiente de aprobación por autoridad Aduanera | Ministerio de Hacienda - DGA -DGT |
| 864 | Incidencia | Escalabilidad: Se determina que documento de identidad no esta registrado en ATENA | Ministerio de Hacienda - DGA -DGT |
| 910 | Incidencia | Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC | Ministerio de Hacienda - DTIC |

### 2.10 Problemas de Pago (grupo 869)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 870 | Incidencia | Problemas con el envío, respuesta o visualización del pago | Consorcio - Mesa de Servicio N1 |
| 871 | Incidencia | Problemas de anulación del DUA | Consorcio - Mesa de Servicio N1 |
| 873 | Incidencia | Problemas con la cuenta bancaria | Consorcio - Mesa de Servicio N1 |
| 874 | Incidencia | Problemas para registrar la cuenta bancaria de un usuario en ATENA | Consorcio - Mesa de Servicio N1 |
| 872 | Incidencia | Escalamiento: Requiere registrar la cuenta bancaria a un usuario | Ministerio de Hacienda - DGA -DGT |
| 906 | Incidencia | Escalamiento al Banco Central para validación técnica hasta conseguir la solución | Ministerio de Hacienda - DTIC |
| 905 | Incidencia | Escalamiento al area Técnica del MdH para validar si los servicios de API REST "tesoro digital" (Ej: Web Banking, SINPE) esta operativo | Ministerio de Hacienda - DTIC |

### 2.11 Problemas desarrollador API (grupo 875)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 876 | Incidencia | Falla en el metódo de autenticación o token API | Consorcio - Mesa de Servicio N1 |
| 877 | Incidencia | Falla en la integración o problemas con el API | Consorcio - Mesa de Servicio N1 |
| 925 | Requerimiento | Consultas sobre documentación del API | Consorcio - Mesa de Servicio N1 |

### 2.12 Consulta sobre el Manual de Procedimientos Aduaneros (grupo 897)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 898 | Requerimiento | Consultas sobre el Manual de Procedimientos Aduaneros o Circulares, Directrices y Resoluciones recientes sobre ajustes al procedimiento en ATENA | Consorcio - Mesa de Servicio N1 |
| 899 | Requerimiento | Escalamiento solo cuando existen consultas sobre el manual de procedimientos aduaneros, LGA - Ley General de Aduanas, RLGA - Reglamento Ley General de Aduanas o novedades sobre Circulares o Directrices (> 1 semana) | Ministerio de Hacienda - DGA -DGT |

### 2.13 Problemas en el proceso de rectificacion (grupo 879)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 880 | Incidencia | Se están definiendo las politicas de rectificación, después de confirmación | Consorcio - Mesa de Servicio N1 |

### 2.14 Problemas en la Firma Digital (grupo 881)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 882 | Incidencia | Problemas para firmar digitalmente en ATENA | Consorcio - Mesa de Servicio N1 |
| 883 | Incidencia | Se detecta que el error es externo, se sensibiliza a contactar a su proveedor de firma digital | Consorcio - Mesa de Servicio N1 |
| 908 | Incidencia | Escalamiento al area Técnica del MdH para validar si la plataforma "hacienda autentica" esta operativa | Ministerio de Hacienda - DTIC |

### 2.15 Problemas en Proceso de Levante (grupo 884)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 885 | Incidencia | El sistema no genera la autorización de levante | Consorcio - Mesa de Servicio N1 |
| 886 | Incidencia | Escalamiento: Se determina problema de interoperabilidad es de ATENA | Consorcio - Mesa de Servicio N1 |
| 887 | Incidencia | Escalamiento: Se determina problema de interoperabilidad es del Puerto | Ministerio de Hacienda - Aduanas |

### 2.16 Problemas en Proceso de Tránsito (grupo 888)

| Cód. Sub | Tipo | Subcategoría | Responsable |
|---:|---|---|---|
| 890 | Incidencia | Problemas al tratar de dar inicio o fin al tránsito, o no actualización del estado de la DUA | Consorcio - Mesa de Servicio N1 |
| 891 | Incidencia | Problemas al tratar de modificar datos de tránsito | Consorcio - Mesa de Servicio N1 |
| 892 | Incidencia | El sistema no generó el comprobante de movilización | Consorcio - Mesa de Servicio N1 |
| 893 | Incidencia | El sistema no muestra la opción de Generar Tránsito (T1) | Consorcio - Mesa de Servicio N1 |
| 894 | Incidencia | El sistema no permite realizar la operación de agrupar DUAS para generar un solo Tránsito (T1) | Consorcio - Mesa de Servicio N1 |
| 895 | Incidencia | Imposibilidad de imprimir el comprobante de movilización | Consorcio - Mesa de Servicio N1 |
| 896 | Incidencia | Problemas para revisar una incidencia en tránsito y actualización de los estados (Usuario: Aduana) | Consorcio - Mesa de Servicio N1 |
| 903 | Requerimiento | Imposibilidad de reportar incidencias en carretera Ejemplo: ocurrió el incidente y el usuario no sabe que hacer o no se le habilitó la funcionalidad de registrar incidencias | Consorcio - Mesa de Servicio N1 |
| 889 | Incidencia | Incidencia pendiente de autorización por parte de la Aduana | Ministerio de Hacienda - DGA -DGT |

---

## 3. Mapeo GLPI ↔ Aranda (por nombre)

Cada subcategoría GLPI se traduce a un código Aranda + segmento. Esta es la relación que carga `service_catalog_sync` (ver `scripts/seed-catalog-local.js`).

### 3.1 Problema al modificar la DUA posterior a la aceptación

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| No permite modificar un campo | 821 | 1 (IM) |
| Permite modificar un campo, pero no se refleja el ajuste | 822 | 1 (IM) |

### 3.2 Problemas al Guardar / Almacenar

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Problemas al intentar guardar o recuperar borradores/versiones de la DUA | 824 | 1 (IM) |

### 3.3 Problemas Asociados a la Infraestructura IT (Oculta)

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC a nivel Infraestructura IT | 914 | 1 (IM) |

### 3.4 Problemas Asociados a la Selectividad

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Problema Técnico a la hora del crear una regla. (Los usuarios serán la DGR) | 827 | 1 (IM) |
| No se generó el Levante automático | 829 | 1 (IM) |
| No se visualiza el aforador asignado | 830 | 1 (IM) |
| Problemas con la notificación recibida por correo | 831 | 1 (IM) |
| Problemas con las observaciones | 832 | 1 (IM) |
| Problemas en el enrutamiento del DUA | 833 | 1 (IM) |
| Problemas en la reasignación de DUAs | 834 | 1 (IM) |
| Problemas técnicos por parte del aforador | 900 | 4 (RF) |
| Se detecta un problema en la regla o se requiere ajustar la regla. (Ej: Regla mal hecha, bajar la selectividad) | 901 | 4 (RF) |
| Dificultades relacionadas al proceso de impugnación sobre el aforo realizado | 826 | 1 (IM) |
| Problemas asociados a la selección o cargas de trabajo y asignación de aforador | 828 | 1 (IM) |

### 3.5 Problemas con el cálculo de la Liquidación

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Error en el cálculo de la liquidación | 836 | 1 (IM) |
| Se determina que el error esta en ATENA (endopint de API) | 838 | 1 (IM) |
| Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR | 840 | 1 (IM) |
| Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios sin actualizar | 837 | 1 (IM) |
| Se determina que el error esta en el API del cliente que generó el DUA, se insta a comunicarse con su proveedor | 839 | 1 (IM) |

### 3.6 Problemas con Llenado y Aceptación

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| No existe claridad sobre el error que genera el sistema | 842 | 1 (IM) |
| El sistema no acepta la declaración o la acepta y no numera. | 843 | 1 (IM) |
| El sistema no permite editar el DUA después de haberlo guardado | 844 | 1 (IM) |
| Faltan opciones en un combo box | 845 | 1 (IM) |
| Consulta sobre llenado de un campo específico | 902 | 4 (RF) |

### 3.7 Problemas de Acceso

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| No se puede ingresar a Atena (error de autenticación, plataforma no disponible). | 847 | 1 (IM) |
| Problemas con la asignación de perfiles | 849 | 1 (IM) |
| Problemas con el Perfil asignado | 848 | 1 (IM) |
| Autorización de cuentas de Usuario | 850 | 4 (RF) |
| Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo | 912 | 4 (RF) |
| Solicitud y asignación de Perfil de Acceso | 852 | 4 (RF) |
| La solicitud Implica Activación Usuario Contingencia Mesa valida que la solicitud venga con el documento de identidad adjunto por ambos lados. | 926 | 4 (RF) |
| La solicitud Implica Activación Usuario Contingencia DGA valorar si corresponde | 927 | 4 (RF) |
| La solicitud Implica Activación Usuario Contingencia DTIC Notifica al solicitante con el usuario y contraseña | 928 | 4 (RF) |

### 3.8 Problemas de Anotación de Salida

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| El sistema no permite registrar la salida efectiva de la mercancía | 854 | 1 (IM) |
| En segmento Boletín de Liquidación no se genera el link para generar la anotación de salida | 855 | 1 (IM) |

### 3.9 Problemas de Asociación de Documentos LPCO

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Consultar sobre el tipo de documento LPCO requerido para una operación específica. | 857 | 1 (IM) |
| Error al intentar adjuntar, vincular o visualizar un documento LPCO. | 858 | 1 (IM) |
| Escalabilidad: Falla en la conexión de interoperabilidad de ATENA con el organismo emisor del LPCO. (Problemas endpoint) | 859 | 1 (IM) |
| Se detectan problemas de validación al asociar un LPCO | 862 | 1 (IM) |
| LPCO aprobado por organismo emisor pero no esta en ATENA | 865 | 1 (IM) |
| Problemas al solicitar un permiso en el módulo LPCO | 866 | 1 (IM) |
| Problemas en el módulo LPCO al aprobar un permiso (Usuario: DGT - Estadística y Registro o Aduanas) | 867 | 1 (IM) |
| Problemas en el módulo LPCO con el registro del permiso por parte del ente emisor. (Ejemplo Ministerio de Seguridad, OFINASE, que no usan ninguna plataforma) | 868 | 1 (IM) |
| Escalabilidad: Se determina problemas en la digitación del permiso aprobado en el módulo LPCO por parte del ente emisor. (Ejemplo Ministerio de Seguridad, OFINASE) | 863 | 1 (IM) |
| Escalabilidad: Se detecta que el problema de interoperabilidad esta del lado de las instituciones y no del Consorcio | 860 | 1 (IM) |
| Permiso solicitado en el módulo LPCO pendiente de aprobación por autoridad Aduanera | 861 | 1 (IM) |
| Escalabilidad: Se determina que documento de identidad no esta registrado en ATENA | 864 | 1 (IM) |
| Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC | 910 | 1 (IM) |

### 3.10 Problemas de Pago

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Problemas con el envío, respuesta o visualización del pago | 870 | 1 (IM) |
| Problemas de anulación del DUA | 871 | 1 (IM) |
| Problemas con la cuenta bancaria | 873 | 1 (IM) |
| Problemas para registrar la cuenta bancaria de un usuario en ATENA | 874 | 1 (IM) |
| Escalamiento: Requiere registrar la cuenta bancaria a un usuario | 872 | 1 (IM) |
| Escalamiento al Banco Central para validación técnica hasta conseguir la solución | 906 | 1 (IM) |
| Escalamiento al area Técnica del MdH para validar si los servicios de API REST "tesoro digital" (Ej: Web Banking, SINPE) esta operativo | 905 | 1 (IM) |

### 3.11 Problemas desarrollador API

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Falla en el metódo de autenticación o token API | 876 | 1 (IM) |
| Falla en la integración o problemas con el API | 877 | 1 (IM) |
| Consultas sobre documentación del API | 925 | 4 (RF) |

### 3.12 Consulta sobre el Manual de Procedimientos Aduaneros

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Consultas sobre el Manual de Procedimientos Aduaneros o Circulares, Directrices y Resoluciones recientes sobre ajustes al procedimiento en ATENA | 898 | 4 (RF) |
| Escalamiento solo cuando existen consultas sobre el manual de procedimientos aduaneros, LGA - Ley General de Aduanas, RLGA - Reglamento Ley General de Aduanas o novedades sobre Circulares o Directrices (> 1 semana) | 899 | 4 (RF) |

### 3.13 Problemas en el proceso de rectificacion

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Se están definiendo las politicas de rectificación, después de confirmación | 880 | 1 (IM) |

### 3.14 Problemas en la Firma Digital

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Problemas para firmar digitalmente en ATENA | 882 | 1 (IM) |
| Se detecta que el error es externo, se sensibiliza a contactar a su proveedor de firma digital | 883 | 1 (IM) |
| Escalamiento al area Técnica del MdH para validar si la plataforma "hacienda autentica" esta operativa | 908 | 1 (IM) |

### 3.15 Problemas en Proceso de Levante

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| El sistema no genera la autorización de levante | 885 | 1 (IM) |
| Escalamiento: Se determina problema de interoperabilidad es de ATENA | 886 | 1 (IM) |
| Escalamiento: Se determina problema de interoperabilidad es del Puerto | 887 | 1 (IM) |

### 3.16 Problemas en Proceso de Tránsito

| Subcategoría GLPI | Aranda Sub | Segmento |
|---|---:|---|
| Problemas al tratar de dar inicio o fin al tránsito, o no actualización del estado de la DUA | 890 | 1 (IM) |
| Problemas al tratar de modificar datos de tránsito | 891 | 1 (IM) |
| El sistema no generó el comprobante de movilización | 892 | 1 (IM) |
| El sistema no muestra la opción de Generar Tránsito (T1) | 893 | 1 (IM) |
| El sistema no permite realizar la operación de agrupar DUAS para generar un solo Tránsito (T1) | 894 | 1 (IM) |
| Imposibilidad de imprimir el comprobante de movilización | 895 | 1 (IM) |
| Problemas para revisar una incidencia en tránsito y actualización de los estados (Usuario: Aduana) | 896 | 1 (IM) |
| Imposibilidad de reportar incidencias en carretera Ejemplo: ocurrió el incidente y el usuario no sabe que hacer o no se le habilitó la funcionalidad de registrar incidencias | 903 | 4 (RF) |
| Incidencia pendiente de autorización por parte de la Aduana | 889 | 1 (IM) |

---

## 4. Notas de alineación

- **Cobertura:** 77/77 subcategorías GLPI mapeadas a Aranda (100%).
- **Profundidad:** GLPI es de 3 niveles (MDH > Grupo > Sub); Aranda de 2 (Grupo → Sub). La raíz MDH no tiene equivalente Aranda.
- **Tipo de caso:** en GLPI es implícito (flags `is_request`/`is_incident`); en Aranda es explícito por segmento (IM=1 / RF=4). El segmento del mapeo proviene de la columna *Tipo* de Aranda.
- **Escalamientos Aranda:** algunos grupos de escalamiento Aranda (904, 907, 909, 911) se aplanan al grupo base correspondiente en GLPI; sus subs aparecen bajo el grupo padre GLPI.
- **Regeneración:** ante cualquier cambio en `glpi_categories.csv` o `Libro1.utf8.csv`, correr `node scripts/build-catalog-doc.js` para re-sincronizar este documento, y `node scripts/seed-catalog-local.js` para re-cargar `service_catalog_sync`.

---

_Implementación del sync de catálogo y decisiones funcionales: ver `PLAN_IMPLEMENTACION.md §9`._
