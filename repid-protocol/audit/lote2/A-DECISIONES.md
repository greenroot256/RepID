# Lote 2 — Decisiones y cambios especificados (A)

> Parte del entregable A de la auditoría RepID. Documenta las decisiones del lote 2
> (puntos 2.1, 2.2, 2.3, 2.4, 2.5, 2.4b, 2.5b) tras su verificación contra el estado
> `0.3.0` de `repid-protocol`, y las 8 secciones de `WHITE-PAPER.md` que las
> guías actualizan.
>
> Convenciones: `[Leído]`=citado textualmente desde el repositorio o la referencia
> oficial; `[Inferido]`=deducido del diseño; `[No verificado]`=pendiente de
> ejecución real. **Nada de este lote se ejecutó** (sin compilar, sin VM, sin tests):
> es especificación, no implementación.
>
> Estado de los diffs: `audit/lote2/B-diffs/*.diff` se entregan **sin aplicar**
> y verificados con `git apply --check`. La versión de protocolo propuesta es
> `0.4.0` (un solo paso MINOR porque el lote es integramente clase MAJOR, SPEC-010 §4.1).

---

## P.2.1 Contexto en el commitment del recibo (rubro, roles, metadata)

### Decisión
Se adopta la **Opción 2**: el commitment del recibo pasa de vacío a **36 bytes**
(`0x10`/`0x11` format + 1 categoría + 1 rol A + 1 rol B + 32 hash de metadata),
con el commitment vacío como forma legada. Se reescribe RF-05 con una frontera
explícita en vez de negar la clasificación.

### Por qué
`receipt_genesis.cash` **no inspecciona** el commitment del output 0
(`receipt_genesis.cash:114,121` solo miran los Rating Rights). El commitment
vacío es una regla del indexer (SPEC-009 RF-W40), no un invariante de la VM:
por eso el cambio **no toca ningún covenant ni regenera ningún artefacto**.

Ambas partes firman la transacción de genesis y el covenant exige ambas firmas
(RF-01), así que el commitment queda **acordado por los dos, verificable**. Esa
es la única ventaja que ningún esquema off-chain puede dar.

### Layout en bytes (normativo)
```
commitment := <vacío> | 0x10 <category> <roleA> <roleB> | 0x11 <category> <roleA> <roleB> <hash[32]>
            0           4 bytes                             36 bytes
byte 0      formato   nibble alto = versión de formato (0x01)
                      nibble bajo = flags: bit0 = HAS_HASH; bits1..3 = 0
byte 1      category  rubro (vocabulario cerrado, lectura tolerante)
byte 2      roleA     rol de la clave que bloquea el output 0 (receiptOwnerPkh)
byte 3      roleB     rol de la otra clave (la del par cruzado de Rating Rights)
byte 4..35  hash      SHA256 sobre la preimagen de contexto (solo 0x11; ver RF-08)
```
- Longitudes válidas: **0** (legado), **4**, **36**. Cualquier otra → contenedor
  mal formado → **sin hecho** (nunca `valid:false`): no se puede parsear.
- Formato desconocido o flag reservado puesto a 1 → **sin hecho**. Mismo criterio
  que los tags con revisión desconocida (SPEC-010 §6): no lo sabemos leer.
- Valores de `category` y `role` **desconocidos → hecho válido**, con el valor
  crudo preservado (lectura tolerante, Q4).
- `roleA == roleB` es lícito (interacción pareja-pareja).
- El rol se ata a **una clave concreta del recibo**: `roleA` a `receiptOwnerPkh`
  (clave P2PKH del output 0, la que financia, RF-07) y `roleB` a la otra clave,
  derivada del par cruzado de los Rating Rights (RF-W40). Ningún `pkh` nuevo va
  al commitment: las dos claves ya están en el hecho.

### Vocabulario (protocol/constants.json)
Categorías: `0x00` sin especificar; `0x01` mensajería/entrega personal;
`0x02` viaje/transporte; `0x03` trabajo freelance/digital; `0x04` bienes/mercado;
`0x05` servicios profesionales; `0x06`–`0xFE` sin asignar (desconocido → válido);
`0xFF` reservado (documental).
Roles: `0x00` sin especificar; `0x01` `client`; `0x02` `provider`; `0x03` `peer`;
`0x04`–`0xFE` sin asignar; `0xFF` reservado.

### Regla de añadir valores
Los códigos **reservados nunca se reasignan**. Añadir un valor nuevo en el
espacio sin asignar es **MINOR** (los lectores viejos, por lectura tolerante,
siguen aceptando el hecho). Cambiar el sentido de un valor ya asignado es
**MAJOR**. Añadir un byte/campo nuevo al commitment es **MAJOR** (cambia la
longitud aceptada) y se publica como formato `0x12+`.

### Preimagen del hash de contexto (0x11)
El hash de un commitment de 36 bytes **no** usa la preimagen de P.2.5b (que está
anclada a un `raterPkh`). Se define una propia, **sin sal** (el contexto es
acordado por ambas firmas; no se presume secreto):

```
contextHash := SHA256("REPID-RCTX-V1"  +  metadata)
               "REPID-RCTX-V1" = 0x52455049442d524354582d5631 (12 B ASCII)
               metadata       = payload UTF-8 definido por la aplicación,
                                acordado por ambas partes, entregado off-chain
```
El protocolo solo exige el resultado de 32 bytes; no define el `metadata`.

### Reevaluación de RF-05
RF-05 pasa a decir: el recibo no hereda lógica específica de aplicaciones (ni
identificadores de app, ni precios, ni texto libre, ni juicios), **pero puede
llevar una clasificación genérica y cerrada** (categoría + roles), acordada por
ambas firmas. La frontera es: *genérico y cerrado* sí; *específico de una app*
no.

### Tests mínimos (candidatos para C)
Recibo vacío (legado) ✓; 4 bytes ✓; 36 bytes ✓; 1/2/3/5..35 bytes → sin hecho;
formato `0x00`→`0x1f` inválidos → sin hecho; bandera reservada → sin hecho;
categoría/rol desconocidos → hecho válido con valor crudo; commitment > 40 B
(lo rechaza la cadena; vector negativo de reconocimiento).

### Riesgos
- La garantía "contexto bien formado" vive en el indexer, no en la VM: un recibo
  mal formado se descarta sin hecho. Aceptado: ambas partes lo firman.
- El rubro es una afirmación conjunta, no una verificación de que ocurrió.
- `receiptCategory` en `RATING_ISSUED` no cambia el payload (1 byte score); se
  resuelve del Rating Right rastreado. El esquema `additionalProperties:false`
  sí cambia (campo nuevo).

---

## P.2.2 Recibo al inicio de la interacción

### Decisión
**Opción 1**: sin cambios on-chain. SPEC-003 declara en §5 una guía de ciclo de
vida y aclara la semántica normativa ya vigente.

### Por qué (verificado)
- SPEC-003 §1 y RF-01 exigen **firma conjunta**; no dicen "ocurrió". La única
  afirmación de ocurrencia es RF-06 (`PLATFORM_CONFIRMATION`).
- Mover el recibo al inicio **no contradice** el texto normativo; elimina la
  ambigüedad de RF-06. Emitirlo al final da, hoy, una *prueba implícita* de
  ocurrencia; al inicio esa prueba desaparece y queda solo "acordado".
- La opción 2 no añade ningún hecho ni cambia un byte: es un cambio de *cuándo*,
  no de *qué*. No resuelve la aceptación selectiva y degrada la única señal de
  ocurrencia existente.
- Un escrow que acuñe el recibo al liquidar crearía **dos** recibos y **dos**
  Rating Rights por persona → doble calificación por interacción. Prohibido por
  guía: un recibo por interacción, o al inicio o al liquidar, nunca ambos.

### Texto a añadir en SPEC-003 §5
El recibo prueba que las dos partes **acordaron** la interacción, no que ocurrió.
La ocurrencia la corrobora, si acaso, `PLATFORM_CONFIRMATION`. Emitir el recibo
al inicio es lícito; hará que "recibo sin calificar" sea solo interpretación.
La aceptación selectiva (una parte rechaza firmar para ocultar interacciones
malas) es un riesgo conocido y quedará fuera del protocolo, en el intérprete.

### Rating Rights sin caducidad
Se mantiene (Q6): hoy y para siempre. Sin caducidad: el derecho vive aunque el
recibo envejezca; implica permitir calificaciones tardías y una señal de
"recibos sin calificar" cada vez más muda (interpretación, no hecho).
Con caducidad se necesitaría timelock en `RatingRightVault` (covenant + VM
real) y no compensa: la prisa no es parte del modelo.

### Tests
Sin cambios de reconocimiento: no hay vectores nuevos. Añadir solo 2 casos de
documentación de guía (no ejecutables; quedan como texto en la spec).

---

## P.2.3 Corregir sin borrar el pasado — `RATING_RETRACTION`

### Decisión
**Opción 3**: un solo hecho nuevo, `RATING_RETRACTION` con tag `REPID_RETRACT1`.
`RATING_RESPONSE` y `TRUST_REVOKE` quedan fuera (Q9) y se documenta su
existencia como futura iteración. Con esto el protocolo pasa de **7 a 8 hechos**.

### Formato (normativo)
```
OP_RETURN  <push REPID_RETRACT1·len14>  <push txid[32]>
           tag exacto de 14 bytes        txid del RATING_ISSUED referido, display order
```
- Dos chunks exactos; el segundo de exactamente 32 bytes; cualquier otra
  longitud/reparto → **sin hecho** (mal formado).
- Reglas semánticas (hecho con `valid:false`, nunca "sin hecho"):
  - el txid referido no está en el índice de ratings, o
  - el firmante resuelto (§5 de SPEC-009) no es el `raterPkh` del rating, o
  - el rating ya fue retractado (segunda retractación).
- Quién firma: el rater, con su UTXO P2PKH propio (patrón idéntico a
  `PLATFORM1`/`TRUST1`). Sin covenant, sin VM.
- El hecho original `RATING_ISSUED` **no cambia**: el registro es permanente; el
  intérprete decide el peso de la retractación.

### Precedencia
`RATING_RETRACTION` se inserta en el **puesto 7** de la orden fija (SPEC-009
RF-W23), al final: los tags son disjuntos y no colisionan con las formas
existentes, y la precedencia relativa de las reglas 1..6 se preserva. Un tx que
también acuñe un recibo cae en la regla 3.

### Estado del indexer
Nuevo estado persistente (SPEC-009 §8): **conjunto de ratings retractados**
(txids). Al reconocer la retractación válida, se añade el txid. En un
procesamiento desde cero, una retractación cuya referencia no está indexada se
reduce a `valid:false` (mismo régimen que `PLATFORM_CONFIRMATION` pre-recibo).

### Abuso (análisis)
- **Retractación de algo inexistente** → referencia desconocida → `valid:false`.
- **Coerción/extorsión**: indistinguible de la voluntaria; se declara en §14.
  El hecho es un registro, no un veredicto; el intérprete puede ignorar una
  retractación si hay evidencia externa.
- **Spam**: pagado por fee; supone un costo por transacción (misma postura que
  los Trust Links, SPEC-006 §4).
- **El calificado no responde en cadena**: queda documentado como límite.

### Tests candidatos
Retractación válida ✓; txid desconocido → `valid:false` ✓; firmante ≠ rater →
`valid:false` ✓; segunda retractación → `valid:false` ✓; payload no 32 B → sin
hecho ✓; tag parcial (`REPID_RETRAC...`) → sin hecho (REPID_W04, igualdad
exacta) ✓; retractación que también acuña un recibo → gana la regla 3 ✓.

### Versión
Hecho nuevo = clase MAJOR (SPEC-010 §4). "Siete hechos" → "ocho" en SPEC-010 §3,
SPEC-008 §3.1, WHITE-PAPER §5 y el título del esquema.

---

## P.2.4 Cambio de clave, recuperación y privacidad

### Decisión
**Opción 1**: solo guía de derivación de claves por contexto, sin hecho nuevo.
`KEY_ROTATION` queda fuera. **La recuperación con timelock del
`IdentityVault` se descarta** (Q11) y se documenta en §14.

### La justificación corregida (importante)
Mi afirmación previa —"agregar parámetros al constructor deja el collateral
inspendible"— era **falsa**. Un P2SH es solo `OP_HASH256 <hash> OP_EQUAL`: las
salidas antiguas se gastan con su propio script, que sigue siendo válido en
cadena. La consecuencia real de cambiar el covenant es otra:

1. **El indexer debe reconocer dos versiones del covenant** (la de `0.3.0` y la
   nueva). `recognize.ts:63` hardcodea `VAULT` único y `verifyRedeemScriptBinding`
   acepta uno solo; ambos necesitan una lista. El binding es opt-in, así que el
   reconocimiento base (shape-based) no se rompe.
2. **`covenant-bytecode.json` es un mapa mono-versión**: necesita dimensión de
   versión, y `tools/build-covenant-bytecode.mjs` + `bytecode:check` deben
   producir/verificar las dos.
3. Las identidades legadas conservan el covenant viejo (para 2.5 significa:
   **sin plazo de quemado**).

### Por qué se descarta la recuperación (B)
Un timelock de recuperación haría que **cualquiera** pudiera retirar el
collateral con el tiempo: el collateral dejaría de ser una garantía de
comportamiento. Y liga el destino de los fondos a una clave de respaldo que el
protocolo no puede validar. No es un problema de codificación, es un problema
de modelo.

### Por qué se descarta `KEY_ROTATION` (A)
- Un hecho de rotación firmado por la clave vieja **empeora la privacidad**: hace
  pública la vinculación de identidades, que es justo lo que duele en el reuso
  de direcciones.
- No rota la identidad on-chain (el NFT y el collateral siguen bajo la clave
  vieja), así que no resuelve la pérdida de clave.
- Una clave comprometida puede firmarlo: es evidencia, no autoridad, y como
  evidencia no compensa el daño de privacidad.

### Texto §14
Se declara: "la reputación sigue a la clave, no a la persona; RepID no ofrece
rotación ni recuperación de clave; una clave perdida pierde también el
collateral. Se recomienda custodia off-chain y derivación jerárquica por
contexto."

### Tests
Ninguno (sin cambios on-chain ni de reconocimiento). Queda como documentación.

---

## P.2.5 Colateral con "dientes" — plazo mínimo antes de `burn`

### Decisión
**Opción 1**: `require(this.age >= 144)` como **constante del covenant**, en la
función `burn()` únicamente. `increaseCollateral()` queda instantáneo. No se
toca el commitment de la identidad ni RF-W37.

### Construcción CashScript (verificada contra la referencia oficial)
```
require(this.age >= 144);
```
- `this.age` = `OP_CHECKSEQUENCEVERIFY` a nivel de **UTXO**, solo usable como
  `require(this.age >= <expr>)`; el SDK `addInput({sequence})` lo maneja **en
  bloques** (no soporta chunks de 512 s).
- Requiere **transaction version 2** para que `nSequence` se ejecute por
  consenso.
- Estado: `[No verificado]` compilar con cashc `0.13.2` y ejecutar en **VM
  real** (el mock no ejecuta el VM, CONSTITUTION-AUDIT §7). La referencia
  documenta la construcción; la prueba es tarea de E.

### Desde cuándo corre
La edad es de la UTXO: **desde la confirmación del último re-lock**, es decir
desde el `mint` **o el último `increaseCollateral`**. Un top-up crea una salida
nueva y **reinicia el reloj**: un top-up de 1 sat reinicia la espera. Q14 acepta
y declara esto como limitación, porque no existe construcción en cadena que mida
"edad de la identidad".

### Unidad, mínimo y máximo
- Unidad: bloques.
- Valor: **144** (~1 día a 10 min/bloque); `0` = sin plazo (forma legada).
- Máximo real del campo `nSequence` con semántica CashTokens: `[No verificado]`;
  se mide en E antes de fijar el rango documentado.

### Identidades legadas
Las acuñadas bajo el covenant `0.3.0` **no tienen plazo** y conservan su
bytecode. El índice reconoce **ambas versiones** del vault. Garantía declarada:
el plazo solo aplica a identidades nuevas.

### Riesgos y finanzas
- Collateral inmovilizado por clave perdida: ya existía (§14); ahora además hay
  que esperar 144 bloques incluso en el burn legítimo.
- Inmovilización por pérdida de clave se **agranda** 144 bloques; aceptado.
- No es un juicio de valor: el covenant solo comprueba "pasaron N bloques desde
  que esta UTXO existe"; nunca juzga al titular (principio 2).

### Tests candidatos
`burn` antes de 144 bloques → tx inválida en el VM; en el bloque 144 → válida;
`increaseCollateral` en cualquier momento → válida; top-up reinicia la edad →
burn a bloques huecos falla; identidad legada (covenant viejo) → burn inmediato
válido. Requiere regtest/BCHN, no el mock.

---

## P.2.4b Confirmaciones de plataforma

### Decisión
**Opción 2 limitada a autoparticipación**: una única regla de validez nueva y
sin gastar ningún byte del commitment. La deduplicación vive en el intérprete.

### Regla normativa
> Si el `platformPkh` resuelto es igual a `partyA` o `partyB` del recibo
> referido, el hecho `PLATFORM_CONFIRMATION` se emite con `valid: false`. Se
> lee de los outputs, con o sin binding.

### Lo que NO hace (texto completo, Q16)
- **No deduplica.** Repetir la misma confirmación es un hecho nuevo y válido en
  cada transacción. El intérprete cuenta plataformas **distintas**
  (`platformPkh` únicos por recibo).
- **Evadible por segunda clave.** Una plataforma con dos pares de claves confirma
  sin aparecer como parte del recibo. Se declara en §14: el protocolo no
  distingue "otra plataforma" de "la misma con otra identidad".
- **No gasta commitment**: `4 + 32 + 20 = 56 > 40`; meter un pkh de plataforma
  obligaría a renunciar al hash de metadata de P.2.1 (solo caben `4 + 20 = 24`).
  Descartado.

### Tests candidatos
Confirmación de plataforma para recibo propio → `valid:false` ✓; plataforma
tercera → `valid:true` ✓; plataforma igual a `partyA` y a `partyB` → `valid:false` ✓.

---

## P.2.5b Comentarios verificables — `REPID_RATING2`

### Decisión
**Opción 2**: tag `REPID_RATING2` que produce un hecho `RATING_ISSUED` con un
**campo opcional `commentHash`**. 3 chunks. Salt fuera de cadena, publicada con
el comentario. No es un tipo de hecho nuevo: sigue siendo `RATING_ISSUED`.

### Formato (normativo)
```
OP_RETURN  <push REPID_RATING2·len13>  <push score·len1>  <push commentHash·len32>
```
- Exactamente **3 chunks** (rompe la uniformidad "exactly 2"; se reescribe RF-W22
  y §4). Score y semántica idénticos a `RATING1` (1–5, out-of-range →
  `valid:false`).
- `commentHash` = `SHA256(preimagen)`, 32 bytes, push directo (≤75 B, sin
  `PUSHDATA`, cumple RF-W01/RF-W02).
- 2 chunks de la longitud vieja con este tag → **sin hecho** (RF-W07 extendido).

### Preimagen exacta
```
preimagen := "REPID-CMT-V1"                 // 12 bytes ASCII = 0x52455049442d434d542d5631
           || raterPkh                      // 20 bytes, display order
           || saltLen                       // 1 byte uint8, rango 16..32
           || salt                          // saltLen bytes aleatorios
           || comentario                    // UTF-8 hasta el final
commentHash := SHA256(preimagen)
```
- `raterPkh` en la preimagen ata el comentario al rater y evita reusar el mismo
  comentario entre ratings. Adoptado por "PROCEDE" (se marcó como propuesta).
- `saltLen` explícito: sin él, la concatenación es ambigua.
- La sal **no viaja en cadena**: viaja con el comentario. Mínimo 16 bytes
  aleatorios (Q19/Q20), máximo 32.
- **Sin confidencialidad**: la sal publicada no oculta el texto; solo separación
  de dominio. El protocolo no garantiza disponibilidad del texto: eso es off-chain.

### Colisión con `RATING1`
Imposible: RF-W04 exige igualdad exacta de bytes; los tags se distinguen en el
último byte (13 vs 13, `1` vs `2`). Una transacción lleva un solo tag; a lo sumo
un reconocedor aplica. Si una transacción portara ambos tags en dos outputs, solo
el consumido por la regla 4 produce hecho (primer match).

### §14 y SPEC-004
- §14: "las calificaciones no llevan texto libre" → "las calificaciones no llevan
  texto libre; pueden llevar el hash de un comentario off-chain".
- SPEC-004 §6: sacar "Ratings with free text or comments" de Out of Scope.

### Tests candidatos
`RATING2` score 1–5 + hash → `RATING_ISSUED.commentHash` ✓; score 6 → `valid:false`
✓; 4 chunks → sin hecho ✓; hash de 31/33 B → sin hecho ✓; preimagen: sal 15 B →
rechazada en documentación; verificación `SHA256` fuera de cadena (vector E); tag
`RATING1` sigue emitiendo hecho sin `commentHash` ✓.

---

## Guía de actualización de WHITE-PAPER.md (8 secciones)

### G1. §2 — "What happens when a record is wrong?"
Añadir tras la respuesta 3 del bloque "RepID's answers": el mecanismo de
corrección nuevo es la **retractación** (`REPID_RETRACT1`): el hecho original
permanece, un hecho nuevo lo contrapone firmado por el mismo rater. Corregir
sin borrar; el veredicto queda en el intérprete.

### G2. §5 — "The seven facts"
"seven facts" → "**eight** facts": añadir `RATING_RETRACTION` a la lista y a la
tabla de relaciones. Ajustar la frase de la tabla "seven" → "eight".

### G3. §6.5 — "Ratings, platform confirmations and trust links"
Actualizar el párrafo de Rating Rights: no son "tokens ordinarios sin covenant";
están encerrados en `RatingRightVault` (P2SH32) y su spend quema el NFT
(`receipt_genesis.cash` header; SPEC-008 RF-O822). Eliminar la frase obsoleta de
§6.4 "third output = change" si contradice RF-W38 (3 o 4 outputs; el 3/4 es
tokenless). *(Corrección de documentación pre-existente, incorporada.)*

### G4. §7.1 — "The container"
Sin cambios normativos (los 32 B del hash son push directo). Añadir un párrafo:
"las reglas estrictas de este § se aplican igual a los payloads de `RATING2`, que
requieren exactamente 3 chunks y un tercer chunk de exactamente 32 bytes".

### G5. §7.2 — "The five tags and their payloads"
Título "three tags" → "**five**" (los tres existentes más `REPID_RATING2` y
`REPID_RETRACT1`; el conteo nuevo también en SPEC-009 §4, "Three tags are
defined" → "Five tags are defined"). Tabla: añadir fila `REPID_RATING2` (13 B, 3
chunks, score 1 B + hash 32 B) y fila `REPID_RETRACT1` (14 B, 2 chunks, txid 32 B).
Corregir el párrafo "a rating payload is a single byte": vale para `RATING1`;
`RATING2` añade el hash.

### G6. §7.4 — "Recognizing the genesis facts structurally"
Receipt genesis: sustituir "must have an **empty** commitment" por "must have an
empty, a 4-byte (`0x10`) or a 36-byte (`0x11`) context commitment (SPEC-009
RF-W40/RF-W64)". Añadir: el commitment vacío es la forma legada.

### G7. §8.1 — "The fixed order of attempts"
Añadir el paso 7: `RATING_RETRACTION` → retracted. Comentar que el tag del hecho
es disjunto de los demás y que el `RATING2` se resuelve en el paso 4 existente.

### G8. §8.2 — "The state an indexer must keep"
Añadir al estado: **el contexto del recibo** (categoría + roles por `RECEIPT_GENESIS`)
y **el conjunto de ratings retractados**. Esto permite validar la retractación y
anotar `RATING_ISSUED` con su categoría.

---

## Decisiones adoptadas por defecto al "PROCEDE" (marcadas)

1. Preimagen de comentario con `raterPkh` incluido (ver P.2.5b). Reversible.
2. El plazo de 144 bloques aplica **solo a `burn`**; `increaseCollateral`
   instantáneo (reinicia el reloj, declarado).
3. Se corrige **obligatoriamente** SPEC-004 (declara falsedades de `0.3.x`:
   Rating Right "sin covenant", commitment "del owner").
4. "Siete hechos" → "ocho" donde aparezca.

## Convención de IDs en B

- SPEC-003: `RF-08` (contexto), `RF-09` (ciclo de vida), `RF-10` (auto-confirmación).
- SPEC-004: `RF-06`/`RF-07` (retractación), `RF-08`/`RF-09` (`RATING2`).
- SPEC-005: `RF-23`+ (tras el RF-22 reservado del lote 1).
- SPEC-008: `RF-V14`+ y filas nuevas de la matriz de vectores.
- SPEC-009: `RF-W64`+ (tras el RF-W63 reservado del lote 1).
- SPEC-010: correcciones §3/§4/§6 y versión `0.4.0`.

---

## P6 — Pase de arquitecto (aplicado, revisión de 2026-10-08)

Decisión del arquitecto sobre los pendientes del lote 2. Los puntos 1–4 se
aplican en el working tree de `repid-protocol` con la subida de versión; el
punto 5 queda documentado como versión futura.

### 1. `commentHash`: la preimagen ata el comentario al recibo

**Sí: incluir `receiptCategory` en la preimagen del comentario.** El layout
normativo queda:

```
preimagen := "REPID-CMT-V1"                 // 12 bytes ASCII = 0x52455049442d434d542d5631
           || receiptCategory               // 32 bytes, display order, la categoría del Receipt al que pertenece el rating
           || raterPkh                      // 20 bytes, display order
           || saltLen                       // 1 byte uint8, rango 16..32
           || salt                          // saltLen bytes aleatorios
           || comentario                    // UTF-8 NFC hasta el final
commentHash := SHA256(preimagen)
```

- `receiptCategory` es el campo on-chain del `RECEIPT_GENESIS` (0x11 preimagen
  sin relación con los rubros de interacción): lo recupera el rater del recibo
  que firmó y cualquier lector de la pista de Rating Rights. Cada rating queda
  ligado **a un único recibo**, de modo que el mismo texto y la misma nota no
  pueden reutilizarse entre dos interacciones del mismo rater.
- El vector KAT de `comment-hash-vectors.test.mjs` se regenera **una sola vez**
  con la nueva preimagen (107 bytes) y usa la `receiptCategory` **real** del
  fixture Chipnet de 2026-09-27 (`real-chain-facts.json`, `5f4c7226…b36b0`), de
  modo que el vector vuelve a anclar datos reales, no ejemplos sintéticos. El
  digest se calculó de forma independiente (segunda vía) y se verificó que la
  vía de cálculo reproduce también el vector anterior antes de reemplazarlo.

### 2. `contextHash`: **sin** preimagen publicada

El `contextHash` de la forma `0x11` **sigue sin preimagen publicada**. La regla
borrador que publicaba `SHA256('REPID-RCTX-V1' ‖ metadata)` se **elimina**
(RF-12 fuera de SPEC-004, vector KAT y fila de Anexo B.4 fuera de SPEC-009; sin
cambio de lectura de transacción histórica: el reconocedor nunca decodifica el
`contextHash`). En su lugar solo se registra como hecho el **conteo de bytes**
del prefijo: `REPID-RCTX-V1` son **13** bytes ASCII (antes se afirmaba 12;
`constants.json` `prefixBytes` corregido `12 → 13`). El KAT conserva un guard
que fija ese conteo para que un productor que copie el número viejo no trunque.

### 3. §13 del WHITE-PAPER: la matriz de evidencia en tres niveles

Se reescribe la matriz "What is proven per fact type" con **tres niveles de
evidencia**, no intercambiables:

- **(a) transacción real con txid** — la transacción existe, fue emitida a la red
  de prueba y su `txid` quedó registrado;
- **(b) VM local sin transmitir** — el covenant (o spend) fue ejecutado por la
  VM real localmente (libauth `BCH_2026_05`), pero nunca se emitió;
- **(c) solo especificado / reconocimiento** — la forma está especificada y
  cubierta por los vectores de reconocimiento, sin ejecución por la VM.

Con "ejecutado" definido como nivel (a): **5 de 8** tipos de hecho tienen
transacción real con txid (genesis de identidad, genesis de recibo, rating
emitido, confirmación de plataforma y Trust Link, todos de la corrida Chipnet
del 2026-09-10, TASK-026). Burn de identidad es nivel (b) (VM local,
`identity-vault-burn-delay.test.mjs`). Top-up de collateral, retractación de
rating y toda la columna de covenant del top-up quedan en nivel (c): el top-up
nunca se ejecutó ni por la VM local (no hay test de VM para `increaseCollateral`
en la suite) ni en Chipnet (la corrida de `chipnet-vault-e2e.mjs` quedó
pendiente del arquitecto, TASK-037), y la retractación no tiene endpoint en la
demo ni transacción real. Se aplica el criterio con la misma vara a plataforma
(a), Trust Link (a) y retractación (c).

### 4. Versión

Cita literal de SPEC-010 §4.1: *"While the version is `0.y.z`, a change that
would constitute a `MAJOR` change under the rules above MUST increment the
**`MINOR`** number and MUST NOT increment the `PATCH` number."* La preimagen
normativa de `commentHash` cambia en un punto que los productores deben seguir
(SPEC-009 §4.2); aunque no altera la lectura de transacciones históricas por el
reconocedor (el `commentHash` es opaco on-chain, RF-09), el alcance toca la
semántica normativa que un productor copia, así que se clasifica como cambio de
clase `MAJOR` bajo §4 y, por §4.1, se promueve **MINOR**: `0.4.0 → 0.5.0`. El
fondo se documenta en SPEC-010 §2 y en el WHITE-PAPER §14.

### 5. P1 — registro de bytecodes por versión y datos reales (futura aparte)

Se aprueba **en principio** pero como **versión aparte** (futura): antes de
implementarlo hay que proponer un registro de bytecodes por versión y comprobar
que los datos reales de Chipnet se siguen reconociendo. No se aplica en este
pase.

### 6. Declaración de `0.5.0` en el SDK y el registry de la vault

El SDK declara soporte de lectura de `0.5.0` de forma deliberada — el juego de
pruebas que lo bloqueaba (`sdk_version.test.ts`: "rejects a version that is
merely plausible") era un disparador diseñado para forzar esta revisión, y la
revisión concluye que `0.5.0` es un *superset de lectura* de `0.4.0`: su único
cambio normativo es la preimagen del `commentHash`, que es opaca para el
reconocedor, y el `contextHash` nunca tuvo preimagen publicada. El SDK no lee
ningún byte distinto bajo `0.5.0`.

Para que la comprobación de load-time (SPEC-010 §5) pase sin trial matching, el
registry de la vault (`protocol/constants.json` `identityVault.versions`) gana
la entrada `0.5.0` con el cuerpo de la `0.4.0` (el covenant no cambió en
`0.5.0`): una implementación que declara `0.5.0` tiene bytes canónicos qué
verificar (SPEC-009 RF-W56/RF-W76). No añade fuentes ni artefactos; el
`schema.test.mjs` cuenta ahora **artefactos distintos (5)** en lugar de
entradas del registry (6), y `white-paper-claims` deriva "covenant sources" del
número de covenants (4) — antes de esta tanda su guard pasaba por coincidencia
de rango de 40 caracteres.

En el SDK, `SUPPORTED_PROTOCOL_VERSIONS = ['0.3.0', '0.4.0', '0.5.0']`, el
disparador de "versión meramente plausible" avanza a `0.6.0`, y la suite queda
en **150 tests / 150 passed** (15 files), re-medida el 2026-10-08. La próxima
revisión (P1) debe re-evaluar si un `0.5.x` real exige un cuerpo de vault
distinto.