// Arena feel constants. These values are the defaults the game uses (they override the same keys in sim.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { CHARS, MELEE, SHOTS, TUNE, MOVE } from './sim.js';

tunable('arena', [
  { target: TUNE, group: 'Everyone', items: {
    DMG_ALL: { value: 0.7, prop: 'dmg', label: 'Damage multiplier (all attacks)', min: 0.2, max: 2 },
    KB_ALL:  { value: 1,   prop: 'kb',  label: 'Knockback multiplier (all attacks)', min: 0.2, max: 2.5 },
  } },
  { target: MOVE, group: 'Everyone', items: {
    DASH_SPEED: { value: 24,  label: 'Dash speed', min: 8, max: 45 },
    DASH_CD:    { value: 1.4, label: 'Dash cooldown (s)', min: 0.3, max: 4 },
    KB_DECAY:   { value: 3.2, label: 'Knockback fade', hint: 'higher = you stop sliding sooner', min: 0.8, max: 8 },
  } },
  { target: CHARS.blaster, group: 'Blaster', items: {
    BLASTER_SPEED:  { value: 7.0, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    BLASTER_HP:     { value: 100, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    BLASTER_RELOAD: { value: 0.75, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    BLASTER_SPCD:   { value: 6.5, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: SHOTS.blaster, group: 'Blaster', items: {
    BLASTER_SHOT_SPEED: { value: 24, prop: 'speed', label: 'Shot speed', min: 8, max: 60 },
    BLASTER_DMG:        { value: 5, prop: 'dmg',   label: 'Shot damage', min: 0.5, max: 25 },
    BLASTER_KB:         { value: 3, prop: 'kb',    label: 'Shot knockback', min: 0, max: 15 },
  } },
  { target: CHARS.brawler, group: 'Brawler', items: {
    BRAWLER_SPEED:  { value: 7.3, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    BRAWLER_HP:     { value: 150, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    BRAWLER_RELOAD: { value: 0.7, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    BRAWLER_SPCD:   { value: 6.0, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: MELEE.brawler, group: 'Brawler', items: {
    BRAWLER_RANGE: { value: 2.8, prop: 'range', label: 'Melee reach', min: 1, max: 6 },
    BRAWLER_DMG:   { value: 9, prop: 'dmg',   label: 'Melee damage', min: 1, max: 30 },
    BRAWLER_KB:    { value: 9, prop: 'kb',    label: 'Melee knockback', min: 0, max: 25 },
  } },
  { target: CHARS.trickster, group: 'Trickster', items: {
    TRICKSTER_SPEED:  { value: 9.2, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    TRICKSTER_HP:     { value: 100, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    TRICKSTER_RELOAD: { value: 0.5, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    TRICKSTER_SPCD:   { value: 3.0, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: MELEE.trickster, group: 'Trickster', items: {
    TRICKSTER_RANGE: { value: 2.4, prop: 'range', label: 'Melee reach', min: 1, max: 6 },
    TRICKSTER_DMG:   { value: 7.5, prop: 'dmg',   label: 'Melee damage', min: 1, max: 30 },
    TRICKSTER_KB:    { value: 5.5, prop: 'kb',    label: 'Melee knockback', min: 0, max: 25 },
  } },
  { target: CHARS.bomber, group: 'Bomber', items: {
    BOMBER_SPEED:  { value: 7.0, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    BOMBER_HP:     { value: 110, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    BOMBER_RELOAD: { value: 0.95, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    BOMBER_SPCD:   { value: 7.0, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: CHARS.ranger, group: 'Ranger', items: {
    RANGER_SPEED:  { value: 7.0, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    RANGER_HP:     { value: 80, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    RANGER_RELOAD: { value: 1.7, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    RANGER_SPCD:   { value: 5.5, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: SHOTS.ranger, group: 'Ranger', items: {
    RANGER_SHOT_SPEED: { value: 30, prop: 'speed', label: 'Shot speed', min: 8, max: 60 },
    RANGER_DMG:        { value: 9, prop: 'dmg',   label: 'Shot damage', min: 0.5, max: 25 },
    RANGER_KB:         { value: 5, prop: 'kb',    label: 'Shot knockback', min: 0, max: 15 },
  } },
  { target: CHARS.frost, group: 'Frostbite', items: {
    FROST_SPEED:  { value: 7.0, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    FROST_HP:     { value: 100, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    FROST_RELOAD: { value: 0.9, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    FROST_SPCD:   { value: 8.0, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: SHOTS.frost, group: 'Frostbite', items: {
    FROST_SHOT_SPEED: { value: 20, prop: 'speed', label: 'Shot speed', min: 8, max: 60 },
    FROST_DMG:        { value: 3, prop: 'dmg',   label: 'Shot damage', min: 0.5, max: 25 },
    FROST_KB:         { value: 2, prop: 'kb',    label: 'Shot knockback', min: 0, max: 15 },
  } },
  { target: CHARS.ram, group: 'Ram', items: {
    RAM_SPEED:  { value: 7.0, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    RAM_HP:     { value: 165, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    RAM_RELOAD: { value: 0.8, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    RAM_SPCD:   { value: 6.5, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: MELEE.ram, group: 'Ram', items: {
    RAM_RANGE: { value: 2.4, prop: 'range', label: 'Melee reach', min: 1, max: 6 },
    RAM_DMG:   { value: 11, prop: 'dmg',   label: 'Melee damage', min: 1, max: 30 },
    RAM_KB:    { value: 9, prop: 'kb',    label: 'Melee knockback', min: 0, max: 25 },
  } },
  { target: CHARS.hook, group: 'Angler', items: {
    HOOK_SPEED:  { value: 7.1, prop: 'speed',  label: 'Move speed', min: 3, max: 14 },
    HOOK_HP:     { value: 130, prop: 'hp',     label: 'Health', hint: 'from the next spawn', min: 30, max: 300 },
    HOOK_RELOAD: { value: 0.65, prop: 'reload', label: 'Reload per ammo (s)', min: 0.15, max: 3 },
    HOOK_SPCD:   { value: 6.0, prop: 'spCd',   label: 'Special cooldown (s)', min: 1, max: 15 },
  } },
  { target: MELEE.hook, group: 'Angler', items: {
    HOOK_RANGE: { value: 3.4, prop: 'range', label: 'Melee reach', min: 1, max: 6 },
    HOOK_DMG:   { value: 9.5, prop: 'dmg',   label: 'Melee damage', min: 1, max: 30 },
    HOOK_KB:    { value: 5, prop: 'kb',    label: 'Melee knockback', min: 0, max: 25 },
  } },
]);
