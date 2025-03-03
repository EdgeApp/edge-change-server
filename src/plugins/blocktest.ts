import { allPlugins } from './allPlugins'

const bitcoin = allPlugins.find(plugin => plugin.pluginId === 'bitcoin')
if (bitcoin != null) {
  bitcoin.on('connect', () => {
    bitcoin.subscribe('bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc')
    bitcoin
      .scanAddress?.(
        'bc1qmgwnfjlda4ns3g6g3yz74w6scnn9yu2ts82yyc' /* '860728' */
      )
      .then(
        x => console.log(x),
        e => console.log(e)
      )
  })
}
