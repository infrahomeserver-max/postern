import { Icon, KVEditor, useToast } from '../../ui.jsx';
import { download } from '../../api.js';

/* Environment / globals editor, opened as a regular tab next to requests. */
export default function EnvEditor({ env, isGlobals, isActive, onChange, onRename, onSetActive, onDelete }) {
  const toast = useToast();
  const exp = () => download(`${env.name}.postman_environment.json`, JSON.stringify({ name: env.name, values: env.values.map(v => ({ key: v.key, value: v.value, enabled: v.enabled !== false, type: v.secret ? 'secret' : 'default' })), _postman_variable_scope: isGlobals ? 'globals' : 'environment' }, null, 2));
  return (
    <div className="col" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <Icon n={isGlobals ? 'globe' : 'gear'} s={18} c="var(--accent2)" />
        {isGlobals ? <b style={{ fontSize: 15 }}>Globals</b>
          : <input value={env.name} onChange={(e) => onRename(e.target.value)} style={{ fontWeight: 650, fontSize: 15, width: 280 }} aria-label="Environment name" />}
        {isActive && <span className="chip ok">active</span>}
        <span className="grow" />
        {!isGlobals && !isActive && <button className="btn" onClick={() => { onSetActive(); toast(`“${env.name}” is now active`, 'success'); }}><Icon n="check" s={13} />Set active</button>}
        {!isGlobals && isActive && <button className="btn" onClick={onSetActive}>Deactivate</button>}
        <button className="btn" onClick={exp}><Icon n="download" s={13} />Export</button>
        {!isGlobals && <button className="btn danger" onClick={onDelete}><Icon n="trash" s={13} />Delete</button>}
      </div>
      <div style={{ padding: 16 }}>
        <KVEditor rows={env.values} onChange={onChange} keyPh="Variable" valPh="Value" secretValues />
        <p className="muted" style={{ marginBottom: 0 }}>
          Use <code>{'{{variable}}'}</code> in URLs, headers, bodies and auth. Click the lock to mask a value (e.g. tokens, passwords).
          {isGlobals ? ' Globals apply to every request; an active environment overrides them.' : ' Scripts can change values with pm.environment.set().'}
          {' '}All values are stored encrypted.
        </p>
      </div>
    </div>
  );
}
