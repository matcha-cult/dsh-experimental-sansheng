# dsh-experimental-sansheng-profile

Companion bundle for [`dsh-experimental-sansheng`](../README.md): adds the
**三省六部** card to the new-task agent-preset selector.

```sh
dsh plugin --profile web add dsh-experimental-sansheng-profile
```

Installing this bundle is enough: it depends on the core package, mounts the
core host row itself, and adds the preset declaration. A profile that also
enables the core bundle's own row keeps working (the loader resolves the
duplicate id/name to the same row).

The preset reuses the shipped Standard child-plugin catalog with a Lead
persona wearing the 中书省 (planning) and 尚书省 (dispatch/summary) hats. Selecting it starts the session already in the 三省六部 mode; the core
bundle also supports manual entry with `sansheng_mode {action:"enter"}`.

The preset plugin list mirrors the host Standard preset: re-sync
`cordis.patch.yml` when a DSH upgrade changes that catalog.
