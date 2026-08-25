-- El patrón de la camiseta del club (franjas, banda, liso) alimenta el diseño
-- del hueco vacío. No es el escudo de nadie: son dos colores y una geometría.
alter table teams add column if not exists pattern text not null default 'plain';
