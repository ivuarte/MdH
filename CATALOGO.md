# Catálogo de Categorías — GLPI ↔ Aranda

> Documento de referencia. La **fuente de verdad operativa** es `Libro1.utf8.csv` (export funcional Aranda).
> El sync se ejecuta con `scripts/sync-glpi-from-csv.js` (idempotente). Ver `service_catalog_sync` en BD para el estado vivo.

**Fecha de captura:** 2026-06-10
**Última sincronización:** 2026-06-11 (77 mapeos cargados, árbol GLPI bajo MDH reorganizado)
**Origen GLPI:** `https://glpi.iammtechs.com/apirest.php` — todas las categorías ahora bajo MDH (id 658)
**Origen Aranda:** `Libro1.utf8.csv` provisto por equipo funcional

---

## 1. Catálogo GLPI

**Tabla origen:** `glpi_itilcategories`
**Campos relevantes:**

| Campo | Descripción |
|---|---|
| `completename` | Nombre jerárquico (`Padre > Hijo`) |
| `groups_id` | Grupo técnico asignado |
| `users_id` | Técnico a cargo |
| `is_helpdeskvisible` | Visible en Helpdesk |
| `is_request` | Visible para Solicitud |
| `is_incident` | Visible para Incidente |
| `is_problem` | Visible para Problema |
| `is_change` | Visible para Cambio |
| `id` | Identificador único |
| `code` | Código corto (no usado en este export) |

### 1.1 Categorías raíz (Nivel 0)

| ID | Nombre |
|---:|---|
| 658 | MDH |

### 1.2 Categorías Nivel 1 (Hijas de MDH)

| ID | Nombre |
|---:|---|
| 659 | Problemas Asociados a la Selectividad |
| 662 | Problemas con Llenado y Aceptación |
| 664 | Problemas de Acceso |
| 668 | Consulta sobre el Manual de Procedimientos Aduaneros |
| 671 | Problemas desarrollador API |
| 673 | Problemas en Proceso de Tránsito |
| 679 | Problema al modificar la DUA posterior a la aceptación |
| 682 | Problemas al Guardar / Almacenar |
| 683 | Problemas al Guardar / Almacenar *(duplicado)* |
| 684 | Problemas Asociados a la Infraestructura IT (Oculta) |
| 696 | Problemas con el cálculo de la Liquidación |
| 709 | Problemas de Anotación de Salida |
| 712 | Problemas de Asociación de Documentos LPCO |

> ⚠️ **Observación:** los IDs 682 y 683 aparecen como duplicados textuales (`Problemas al Guardar / Almacenar`). Validar con funcional antes del sync.

### 1.3 Categorías Nivel 2 (Detalle completo)

> Todas las categorías son visibles en Helpdesk y para Solicitud, Incidente, Problema y Cambio.

#### 1.3.1 Problemas Asociados a la Selectividad

| ID | Subcategoría |
|---:|---|
| 660 | Problemas técnicos por parte del aforador |
| 661 | Se detecta un problema en la regla o se requiere ajustar la regla. |
| 687 | Problema Técnico a la hora del crear una regla. (Los usuarios serán la DGR) |
| 688 | No se generó el Levante automático |
| 689 | No se visualiza el aforador asignado |
| 690 | Problemas con la notificación recibida por correo |
| 691 | Problemas con las observaciones |
| 692 | Problemas en el enrutamiento del DUA |
| 693 | Problemas en la reasignación de DUAs |
| 694 | Dificultades relacionadas al proceso de impugnación sobre el aforo realizado |
| 695 | Problemas asociados a la selección o cargas de trabajo y asignación de aforador |

#### 1.3.2 Problemas con Llenado y Aceptación

| ID | Subcategoría |
|---:|---|
| 663 | Consulta sobre llenado de un campo específico |
| 702 | No existe claridad sobre el error que genera el sistema |
| 703 | El sistema no acepta la declaración o la acepta y no numera. |
| 704 | El sistema no permite editar el DUA después de haberlo guardado |
| 705 | Faltan opciones en un combo box |

#### 1.3.3 Problemas de Acceso

| ID | Subcategoría |
|---:|---|
| 665 | Autorización de cuentas de Usuario |
| 666 | Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo |
| 667 | Solicitud y asignación de Perfil de Acceso |
| 676 | La solicitud Implica Activación Usuario Contingencia — Mesa valida documento de identidad |
| 677 | La solicitud Implica Activación Usuario Contingencia — DGA valorar si corresponde |
| 678 | La solicitud Implica Activación Usuario Contingencia — DTIC Notifica al solicitante con usuario y contraseña |
| 706 | No se puede ingresar a Atena (error de autenticación, plataforma no disponible). |
| 707 | Problemas con la asignación de perfiles |
| 708 | Problemas con el Perfil asignado |

#### 1.3.4 Consulta sobre el Manual de Procedimientos Aduaneros

| ID | Subcategoría |
|---:|---|
| 669 | Consultas sobre el Manual de Procedimientos Aduaneros o Circulares, Directrices y Resoluciones recientes |
| 670 | Escalamiento solo cuando existen consultas sobre el manual de procedimientos aduaneros, LGA - Ley General de Aduanas, RLGA - Reglamento Ley General de Aduanas o novedades sobre Circulares o Directrices |

#### 1.3.5 Problemas desarrollador API

| ID | Subcategoría |
|---:|---|
| 672 | Consultas sobre documentación del API |

#### 1.3.6 Problemas en Proceso de Tránsito

| ID | Subcategoría |
|---:|---|
| 674 | Imposibilidad de reportar incidencias en carretera |

#### 1.3.7 Problema al modificar la DUA posterior a la aceptación

| ID | Subcategoría |
|---:|---|
| 680 | No permite modificar un campo |
| 681 | Permite modificar un campo, pero no se refleja el ajuste |

#### 1.3.8 Problemas Asociados a la Infraestructura IT (Oculta)

| ID | Subcategoría |
|---:|---|
| 685 | Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC a nivel Infraestructura IT |

#### 1.3.9 Problemas con el cálculo de la Liquidación

| ID | Subcategoría |
|---:|---|
| 697 | Error en el cálculo de la liquidación |
| 698 | Se determina que el error esta en ATENA (endopint de API) |
| 699 | Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR |
| 700 | Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios sin actualizar |
| 701 | Se determina que el error esta en el API del cliente que generó el DUA, se insta a comunicarse con su proveedor |

#### 1.3.10 Problemas de Anotación de Salida

| ID | Subcategoría |
|---:|---|
| 710 | El sistema no permite registrar la salida efectiva de la mercancía |
| 711 | En segmento Boletín de Liquidación no se genera el link para generar la anotación de salida |

#### 1.3.11 Problemas de Asociación de Documentos LPCO

| ID | Subcategoría |
|---:|---|
| 713 | Consultar sobre el tipo de documento LPCO requerido para una operación específica. |
| 714 | Error al intentar adjuntar, vincular o visualizar un documento LPCO. |
| 715 | Escalabilidad: Falla en la conexión de interoperabilidad de ATENA con el organismo emisor del LPCO |
| 716 | Se detectan problemas de validación al asociar un LPCO |
| 717 | LPCO aprobado por organismo emisor pero no esta en ATENA |
| 718 | Problemas al solicitar un permiso en el módulo LPCO |
| 719 | Problemas en el módulo LPCO al aprobar un permiso |
| 720 | Problemas en el módulo LPCO con el registro del permiso por parte del ente emisor |
| 721 | Escalabilidad: Se determina problemas en la digitación del permiso aprobado en el módulo LPCO por parte del ente emisor. |
| 722 | Escalabilidad: Se detecta que el problema de interoperabilidad esta del lado de las instituciones y no del Consorcio |
| 723 | Permiso solicitado en el módulo LPCO pendiente de aprobación por autoridad Aduanera |
| 724 | Escalabilidad: Se determina que documento de identidad no esta registrado en ATENA |
| 725 | Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC |

---

## 2. Catálogo Aranda

**Modelo Aranda:** dos niveles
- **Nivel 1 = Grupo** (`Código Categoría Aranda Grupo`)
- **Nivel 2 = Sub Grupo** (`Código Categoría Aranda Sub Grupo`)

**Campo adicional:** `Tipo` (`Incidencia` vs `Requerimiento`) — define el **CaseType** en Aranda (segment `1`=IM, `4`=RF). Una misma subcategoría puede existir en ambos segmentos.

### 2.1 Grupos Aranda (Nivel 1)

| Código Grupo | Nombre |
|---:|---|
| 820 | Problema al modificar la DUA posterior a la aceptación |
| 823 | Problemas al Guardar / Almacenar |
| 825 | Problemas Asociados a la Selectividad |
| 835 | Problemas con el cálculo de la Liquidación |
| 841 | Problemas con Llenado y Aceptación |
| 846 | Problemas de Acceso |
| 853 | Problemas de Anotación de Salida |
| 856 | Problemas de Asociación de Documentos LPCO |
| 869 | Problemas de Pago |
| 875 | Problemas desarrollador API |
| 879 | Problemas en el proceso de rectificacion |
| 881 | Problemas en la Firma Digital |
| 884 | Problemas en Proceso de Levante |
| 888 | Problemas en Proceso de Tránsito |
| 897 | Consulta sobre el Manual de Procedimientos Aduaneros |
| 904 | Problemas de Pago (escalamiento) |
| 907 | Problemas en la Firma Digital (escalamiento) |
| 909 | Problemas de Asociación de Documentos LPCO (escalamiento) |
| 911 | Problemas de Acceso (escalamiento) |
| 913 | Problemas Asociados a la Infraestructura IT (Oculta) |

> ⚠️ Aranda mantiene **grupos paralelos para escalamientos** (904, 907, 909, 911, 913). Esto NO existe en GLPI — habrá que decidir si esos casos mapean al grupo base o se marcan como subniveles.

### 2.2 Subcategorías Aranda (Nivel 2)

#### 2.2.1 Problema al modificar la DUA posterior a la aceptación (Grupo 820)

| Sub | Tipo | Nombre |
|---:|---|---|
| 821 | Incidencia | No permite modificar un campo |
| 822 | Incidencia | Permite modificar un campo, pero no se refleja el ajuste |

#### 2.2.2 Problemas al Guardar / Almacenar (Grupo 823)

| Sub | Tipo | Nombre |
|---:|---|---|
| 824 | Incidencia | Problemas al intentar guardar o recuperar borradores/versiones de la DUA |

#### 2.2.3 Problemas Asociados a la Selectividad (Grupo 825)

| Sub | Tipo | Nombre |
|---:|---|---|
| 826 | Incidencia | Dificultades relacionadas al proceso de impugnación sobre el aforo realizado |
| 827 | Incidencia | Problema Técnico a la hora del crear una regla. (Los usuarios serán la DGR) |
| 828 | Incidencia | Problemas asociados a la selección o cargas de trabajo y asignación de aforador |
| 829 | Incidencia | No se generó el Levante automático |
| 830 | Incidencia | No se visualiza el aforador asignado |
| 831 | Incidencia | Problemas con la notificación recibida por correo |
| 832 | Incidencia | Problemas con las observaciones |
| 833 | Incidencia | Problemas en el enrutamiento del DUA |
| 834 | Incidencia | Problemas en la reasignación de DUAs |
| 900 | Requerimiento | Problemas técnicos por parte del aforador |
| 901 | Requerimiento | Se detecta un problema en la regla o se requiere ajustar la regla. (Ej: Regla mal hecha, bajar la selectividad) |

#### 2.2.4 Problemas con el cálculo de la Liquidación (Grupo 835)

| Sub | Tipo | Nombre |
|---:|---|---|
| 836 | Incidencia | Error en el cálculo de la liquidación |
| 837 | Incidencia | Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios sin actualizar |
| 838 | Incidencia | Se determina que el error esta en ATENA (endopint de API) |
| 839 | Incidencia | Se determina que el error esta en el API del cliente que generó el DUA, se insta a comunicarse con su proveedor |
| 840 | Incidencia | Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR |

#### 2.2.5 Problemas con Llenado y Aceptación (Grupo 841)

| Sub | Tipo | Nombre |
|---:|---|---|
| 842 | Incidencia | No existe claridad sobre el error que genera el sistema |
| 843 | Incidencia | El sistema no acepta la declaración o la acepta y no numera. |
| 844 | Incidencia | El sistema no permite editar el DUA después de haberlo guardado |
| 845 | Incidencia | Faltan opciones en un combo box |
| 902 | Requerimiento | Consulta sobre llenado de un campo específico |

#### 2.2.6 Problemas de Acceso (Grupo 846)

| Sub | Tipo | Nombre |
|---:|---|---|
| 847 | Incidencia | No se puede ingresar a Atena (error de autenticación, plataforma no disponible). |
| 848 | Incidencia | Problemas con el Perfil asignado |
| 849 | Incidencia | Problemas con la asignación de perfiles |
| 850 | Requerimiento | Autorización de cuentas de Usuario |
| 852 | Requerimiento | Solicitud y asignación de Perfil de Acceso |
| 926 | Requerimiento | La solicitud Implica Activación Usuario Contingencia — Mesa valida documento de identidad |
| 927 | Requerimiento | La solicitud Implica Activación Usuario Contingencia — DGA valorar si corresponde |

#### 2.2.7 Problemas de Acceso (escalamiento, Grupo 911)

| Sub | Tipo | Nombre |
|---:|---|---|
| 912 | Requerimiento | Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo |
| 928 | Requerimiento | La solicitud Implica Activación Usuario Contingencia — DTIC Notifica al solicitante con usuario y contraseña |

#### 2.2.8 Problemas de Anotación de Salida (Grupo 853)

| Sub | Tipo | Nombre |
|---:|---|---|
| 854 | Incidencia | El sistema no permite registrar la salida efectiva de la mercancía |
| 855 | Incidencia | En segmento Boletín de Liquidación no se genera el link para generar la anotación de salida |

#### 2.2.9 Problemas de Asociación de Documentos LPCO (Grupo 856)

| Sub | Tipo | Nombre |
|---:|---|---|
| 857 | Incidencia | Consultar sobre el tipo de documento LPCO requerido para una operación específica. |
| 858 | Incidencia | Error al intentar adjuntar, vincular o visualizar un documento LPCO. |
| 859 | Incidencia | Escalabilidad: Falla en la conexión de interoperabilidad de ATENA con el organismo emisor del LPCO. (Problemas endpoint) |
| 860 | Incidencia | Escalabilidad: Se detecta que el problema de interoperabilidad esta del lado de las instituciones y no del Consorcio |
| 861 | Incidencia | Permiso solicitado en el módulo LPCO pendiente de aprobación por autoridad Aduanera |
| 862 | Incidencia | Se detectan problemas de validación al asociar un LPCO |
| 863 | Incidencia | Escalabilidad: Se determina problemas en la digitación del permiso aprobado en el módulo LPCO |
| 864 | Incidencia | Escalabilidad: Se determina que documento de identidad no esta registrado en ATENA |
| 865 | Incidencia | LPCO aprobado por organismo emisor pero no esta en ATENA |
| 866 | Incidencia | Problemas al solicitar un permiso en el módulo LPCO |
| 867 | Incidencia | Problemas en el módulo LPCO al aprobar un permiso (Usuario: DGT - Estadística y Registro o Aduanas) |
| 868 | Incidencia | Problemas en el módulo LPCO con el registro del permiso por parte del ente emisor |

#### 2.2.10 Problemas de Asociación de Documentos LPCO (escalamiento, Grupo 909)

| Sub | Tipo | Nombre |
|---:|---|---|
| 910 | Incidencia | Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC |

#### 2.2.11 Problemas de Pago (Grupo 869)

| Sub | Tipo | Nombre |
|---:|---|---|
| 870 | Incidencia | Problemas con el envío, respuesta o visualización del pago |
| 871 | Incidencia | Problemas de anulación del DUA |
| 872 | Incidencia | Escalamiento: Requiere registrar la cuenta bancaria a un usuario |
| 873 | Incidencia | Problemas con la cuenta bancaria |
| 874 | Incidencia | Problemas para registrar la cuenta bancaria de un usuario en ATENA |

#### 2.2.12 Problemas de Pago (escalamiento, Grupo 904)

| Sub | Tipo | Nombre |
|---:|---|---|
| 905 | Incidencia | Escalamiento al área Técnica del MdH para validar si los servicios de API REST "tesoro digital" (Ej: Web Banking, SINPE) está operativo |
| 906 | Incidencia | Escalamiento al Banco Central para validación técnica hasta conseguir la solución |

#### 2.2.13 Problemas desarrollador API (Grupo 875)

| Sub | Tipo | Nombre |
|---:|---|---|
| 876 | Incidencia | Falla en el método de autenticación o token API |
| 877 | Incidencia | Falla en la integración o problemas con el API |
| 925 | Requerimiento | Consultas sobre documentación del API |

#### 2.2.14 Problemas en el proceso de rectificacion (Grupo 879)

| Sub | Tipo | Nombre |
|---:|---|---|
| 880 | Incidencia | Se están definiendo las políticas de rectificación, después de confirmación |

#### 2.2.15 Problemas en la Firma Digital (Grupo 881)

| Sub | Tipo | Nombre |
|---:|---|---|
| 882 | Incidencia | Problemas para firmar digitalmente en ATENA |
| 883 | Incidencia | Se detecta que el error es externo, se sensibiliza a contactar a su proveedor de firma digital |

#### 2.2.16 Problemas en la Firma Digital (escalamiento, Grupo 907)

| Sub | Tipo | Nombre |
|---:|---|---|
| 908 | Incidencia | Escalamiento al área Técnica del MdH para validar si la plataforma "hacienda autentica" está operativa |

#### 2.2.17 Problemas en Proceso de Levante (Grupo 884)

| Sub | Tipo | Nombre |
|---:|---|---|
| 885 | Incidencia | El sistema no genera la autorización de levante |
| 886 | Incidencia | Escalamiento: Se determina problema de interoperabilidad es de ATENA |
| 887 | Incidencia | Escalamiento: Se determina problema de interoperabilidad es del Puerto |

#### 2.2.18 Problemas en Proceso de Tránsito (Grupo 888)

| Sub | Tipo | Nombre |
|---:|---|---|
| 889 | Incidencia | Incidencia pendiente de autorización por parte de la Aduana |
| 890 | Incidencia | Problemas al tratar de dar inicio o fin al tránsito, o no actualización del estado de la DUA |
| 891 | Incidencia | Problemas al tratar de modificar datos de tránsito |
| 892 | Incidencia | El sistema no generó el comprobante de movilización |
| 893 | Incidencia | El sistema no muestra la opción de Generar Tránsito (T1) |
| 894 | Incidencia | El sistema no permite realizar la operación de agrupar DUAS para generar un solo Tránsito (T1) |
| 895 | Incidencia | Imposibilidad de imprimir el comprobante de movilización |
| 896 | Incidencia | Problemas para revisar una incidencia en tránsito y actualización de los estados (Usuario: Aduana) |
| 903 | Requerimiento | Imposibilidad de reportar incidencias en carretera |

#### 2.2.19 Consulta sobre el Manual de Procedimientos Aduaneros (Grupo 897)

| Sub | Tipo | Nombre |
|---:|---|---|
| 898 | Requerimiento | Consultas sobre el Manual de Procedimientos Aduaneros o Circulares, Directrices y Resoluciones recientes |
| 899 | Requerimiento | Escalamiento solo cuando existen consultas sobre el manual de procedimientos aduaneros, LGA, RLGA o novedades sobre Circulares o Directrices (> 1 semana) |

#### 2.2.20 Problemas Asociados a la Infraestructura IT (Oculta, Grupo 913)

| Sub | Tipo | Nombre |
|---:|---|---|
| 914 | Incidencia | Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC a nivel Infraestructura IT |

---

## 3. Mapeo propuesto GLPI ↔ Aranda

> Mapeo **textual derivado** del cruce de ambos catálogos. Cada fila se valida por
> **coincidencia exacta de nombre de subcategoría**. Los casos donde Aranda divide
> el grupo en "base + escalamiento" se documentan en notas.

### 3.1 Mapeo por Grupos (Nivel 1)

| GLPI ID | GLPI Nombre | Aranda Grupo | Notas |
|---:|---|---:|---|
| 659 | Problemas Asociados a la Selectividad | 825 | 1:1 |
| 662 | Problemas con Llenado y Aceptación | 841 | 1:1 |
| 664 | Problemas de Acceso | 846 (+ 911 escal.) | Aranda divide en grupo base y grupo de escalamiento |
| 668 | Consulta sobre el Manual de Procedimientos Aduaneros | 897 | 1:1 |
| 671 | Problemas desarrollador API | 875 | 1:1 |
| 673 | Problemas en Proceso de Tránsito | 888 | 1:1 |
| 679 | Problema al modificar la DUA posterior a la aceptación | 820 | 1:1 |
| 682 / 683 | Problemas al Guardar / Almacenar | 823 | Validar duplicado en GLPI |
| 684 | Problemas Asociados a la Infraestructura IT (Oculta) | 913 | 1:1 |
| 696 | Problemas con el cálculo de la Liquidación | 835 | 1:1 |
| 709 | Problemas de Anotación de Salida | 853 | 1:1 |
| 712 | Problemas de Asociación de Documentos LPCO | 856 (+ 909 escal.) | Aranda divide en grupo base y grupo de escalamiento |
| — | *(sin equivalente GLPI)* | 869 / 904 | Problemas de Pago — falta en GLPI |
| — | *(sin equivalente GLPI)* | 879 | Problemas en el proceso de rectificación — falta en GLPI |
| — | *(sin equivalente GLPI)* | 881 / 907 | Problemas en la Firma Digital — falta en GLPI |
| — | *(sin equivalente GLPI)* | 884 | Problemas en Proceso de Levante — falta en GLPI |

> ⚠️ **Grupos huérfanos en Aranda**: Pago (869/904), Rectificación (879), Firma Digital (881/907) y Levante (884) no tienen padre directo en GLPI. Hay que coordinar con funcional si crear esas categorías en GLPI o cómo manejarlas.

### 3.2 Mapeo por Subcategorías (Nivel 2)

> Cada fila es **una traducción directa por nombre**. La columna `Tipo Aranda` indica
> si el caso debe abrirse como IM (Incidencia, segment 1) o RF (Requerimiento, segment 4).

#### Problema al modificar la DUA posterior a la aceptación

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 680 | 821 | Incidencia |
| 681 | 822 | Incidencia |

#### Problemas Asociados a la Selectividad

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 660 | 900 | Requerimiento |
| 661 | 901 | Requerimiento |
| 687 | 827 | Incidencia |
| 688 | 829 | Incidencia |
| 689 | 830 | Incidencia |
| 690 | 831 | Incidencia |
| 691 | 832 | Incidencia |
| 692 | 833 | Incidencia |
| 693 | 834 | Incidencia |
| 694 | 826 | Incidencia |
| 695 | 828 | Incidencia |

#### Problemas con Llenado y Aceptación

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 663 | 902 | Requerimiento |
| 702 | 842 | Incidencia |
| 703 | 843 | Incidencia |
| 704 | 844 | Incidencia |
| 705 | 845 | Incidencia |

#### Problemas de Acceso

| GLPI | Aranda Sub | Tipo | Grupo Aranda |
|---:|---:|---|---:|
| 665 | 850 | Requerimiento | 846 |
| 666 | 912 | Requerimiento | 911 (escal.) |
| 667 | 852 | Requerimiento | 846 |
| 676 | 926 | Requerimiento | 846 |
| 677 | 927 | Requerimiento | 846 |
| 678 | 928 | Requerimiento | 911 (escal.) |
| 706 | 847 | Incidencia | 846 |
| 707 | 849 | Incidencia | 846 |
| 708 | 848 | Incidencia | 846 |

#### Consulta sobre el Manual de Procedimientos Aduaneros

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 669 | 898 | Requerimiento |
| 670 | 899 | Requerimiento |

#### Problemas desarrollador API

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 672 | 925 | Requerimiento |

> ⚠️ Aranda 876 (Falla en autenticación o token API) y 877 (Falla en integración) **no tienen equivalente directo en GLPI**.

#### Problemas en Proceso de Tránsito

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 674 | 903 | Requerimiento |

> ⚠️ Aranda tiene 9 subcategorías de tránsito (889-896), GLPI solo 1. Hay que coordinar.

#### Problemas con el cálculo de la Liquidación

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 697 | 836 | Incidencia |
| 698 | 838 | Incidencia |
| 699 | 840 | Incidencia |
| 700 | 837 | Incidencia |
| 701 | 839 | Incidencia |

#### Problemas de Anotación de Salida

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 710 | 854 | Incidencia |
| 711 | 855 | Incidencia |

#### Problemas de Asociación de Documentos LPCO

| GLPI | Aranda Sub | Tipo | Grupo Aranda |
|---:|---:|---|---:|
| 713 | 857 | Incidencia | 856 |
| 714 | 858 | Incidencia | 856 |
| 715 | 859 | Incidencia | 856 |
| 716 | 862 | Incidencia | 856 |
| 717 | 865 | Incidencia | 856 |
| 718 | 866 | Incidencia | 856 |
| 719 | 867 | Incidencia | 856 |
| 720 | 868 | Incidencia | 856 |
| 721 | 863 | Incidencia | 856 |
| 722 | 860 | Incidencia | 856 |
| 723 | 861 | Incidencia | 856 |
| 724 | 864 | Incidencia | 856 |
| 725 | 910 | Incidencia | 909 (escal.) |

#### Problemas Asociados a la Infraestructura IT (Oculta)

| GLPI | Aranda Sub | Tipo |
|---:|---:|---|
| 685 | 914 | Incidencia |

---

## 4. Diferencias estructurales relevantes

| Dimensión | GLPI | Aranda |
|---|---|---|
| Profundidad | 3 niveles (Raíz "MDH" > Grupo > Subcategoría) | 2 niveles (Grupo > Sub Grupo) |
| Tipo de caso | Implícito en visibilidad (`is_request`, `is_incident`, …) | Explícito por **segmento** (IM=1, RF=4) — la subcategoría se enlaza al segmento |
| Escalamientos | Modelados como subcategorías del mismo grupo | Modelados como **grupo separado** (911, 909, 904, 907, 913) |
| Categorías solo Aranda | — | Pago (869/904), Rectificación (879), Firma Digital (881/907), Levante (884) |
| Categorías solo GLPI | — | (ninguna detectada en este export) |
| Duplicados | GLPI 682 = 683 (`Problemas al Guardar / Almacenar`) | — |

---

## 5. Plan de implementación de `catalogSync`

### 5.1 Esquema de BD propuesto

```sql
-- Migración: 007_catalog_sync.sql

CREATE TABLE IF NOT EXISTS glpi_categories (
  id              INT UNSIGNED PRIMARY KEY,        -- glpi_itilcategories.id
  completename    VARCHAR(512) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  parent_id       INT UNSIGNED NULL,
  level           TINYINT UNSIGNED NOT NULL,
  code            VARCHAR(64) NULL,
  is_helpdesk     TINYINT(1) NOT NULL DEFAULT 1,
  is_request      TINYINT(1) NOT NULL DEFAULT 1,
  is_incident     TINYINT(1) NOT NULL DEFAULT 1,
  is_problem      TINYINT(1) NOT NULL DEFAULT 1,
  is_change       TINYINT(1) NOT NULL DEFAULT 1,
  pulled_at       DATETIME NOT NULL,
  INDEX idx_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS aranda_categories (
  id              INT UNSIGNED PRIMARY KEY,        -- código Aranda (820, 821, …)
  name            VARCHAR(512) NOT NULL,
  parent_id       INT UNSIGNED NULL,
  level           TINYINT UNSIGNED NOT NULL,        -- 1=Grupo, 2=Subgrupo
  case_type       TINYINT NULL,                     -- 1=IM, 4=RF (solo en hojas)
  pulled_at       DATETIME NOT NULL,
  INDEX idx_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS category_mapping (
  glpi_id         INT UNSIGNED NOT NULL,
  aranda_id       INT UNSIGNED NOT NULL,
  aranda_case_type TINYINT NOT NULL,
  confidence      ENUM('manual','exact_name','heuristic') NOT NULL DEFAULT 'manual',
  notes           TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (glpi_id, aranda_id, aranda_case_type),
  INDEX idx_glpi (glpi_id),
  INDEX idx_aranda (aranda_id, aranda_case_type)
);
```

### 5.2 Pasos del servicio

1. **`glpiCategoryPull`** — recorrer `/ITILCategory` y volcar a `glpi_categories`.
2. **`arandaCategoryPull`** — Aranda no expone `/category/list`. Validar si existe en la API del ASDKAPI v8.6; si no, **cargar este `CATALOGO.md` como semilla** vía `scripts/seed-aranda-categories.js`.
3. **`mappingResolver`** — cruzar por nombre exacto (después de normalizar acentos y espacios) y poblar `category_mapping` con `confidence='exact_name'`. Las filas marcadas como `⚠️` en este documento se insertan como `confidence='manual'` con `notes`.
4. **Integración en flujos existentes:**
   - `arandaTicketPush.js`: leer `tickets.itilcategories_id` → `category_mapping` → `CategoryId` + `CaseType`. Si no hay match, usar default actual del `.env`.
   - `arandaTicketPull.js`: leer `CategoryId` + `CaseType` → `category_mapping` → `itilcategories_id` para insertar en `tickets`.

### 5.3 Pendientes funcionales (bloquean catalogSync)

- [ ] Confirmar si los duplicados GLPI 682 y 683 son intencionales o data sucia.
- [ ] Decidir tratamiento de **grupos huérfanos en Aranda** (Pago, Rectificación, Firma Digital, Levante): ¿crear en GLPI o mapear a un genérico?
- [ ] Decidir tratamiento de **subcategorías huérfanas en GLPI** (Tránsito tiene 9 en Aranda, 1 en GLPI; LPCO algunos también).
- [ ] Confirmar si los **grupos de escalamiento Aranda** (904/907/909/911/913) deben mapearse al grupo base GLPI o crearse como hijos en GLPI.
- [ ] Aranda 876 y 877 (API): pedir creación equivalente en GLPI o aceptar pérdida en sync.

---

## 6. Histórico del documento

| Fecha | Cambio |
|---|---|
| 2026-06-10 | Captura inicial GLPI (export provisional) + Aranda (export funcional). Mapeo textual derivado. |
| 2026-06-11 | Sincronización completa GLPI ↔ CSV: los 13 grupos preexistentes movidos bajo MDH (658). Creados 4 grupos nuevos (727 Pago, 728 Rectificación, 729 Firma Digital, 730 Levante) y 25 subs faltantes (ids GLPI 731-755). `service_catalog_sync` pasa de 52 → 77 entradas (cobertura total del catálogo Aranda). El duplicado 682/683 se mantiene sin tocar; el sub 824 cuelga de 682. Escalamientos Aranda 904/907/909/911 aplanados al grupo base GLPI. Script idempotente: `scripts/sync-glpi-from-csv.js`. |
