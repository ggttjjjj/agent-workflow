type IconName = 'menu' | 'plus' | 'arrow' | 'image' | 'settings' | 'sparkles';
const paths: Record<IconName, string> = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M12 19V5m-6 6 6-6 6 6',
    image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M8 8h.01',
    settings: 'M9 4h6l1 3 3 1 1 6-3 2-1 4h-6l-1-3-4-2V9l3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    sparkles: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z'
};
export default function Icon({name, size = 20}: {name: IconName; size?: number}) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}
