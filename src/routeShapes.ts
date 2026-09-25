import type { Direction } from "./data";

// Road geometry generated 2026-09-25 from OpenStreetMap streets using OSRM.
// Each BusGarraf-published stop is a routing waypoint, in its published order.
// The geometry is stored locally so the map does not need a routing API at runtime.
// This is a road-network route, not an official live bus trace.
const encodedShapes = {
  "to-tarragona": [
    "}q{rmAw{rhBvCnPwAl@o@VwAh@mAb@oFtBHtElDnQrArC`@dBhNlo@H`@bDfQJh@TlAwA^sMtFmu@vZw@\\[LuBt@bAjFP`AjHh]`",
    "DtP^jBdA~Ex@zDp@tDhBtJrG~[v@vD|@vDTxA~Ivd@rHx^b@vB~@dFj@rBz@pERbAjNfs@gB`As@\\cIfEsA@sI`GyEdEmHhHuCdB",
    "wBrCeBzAaQzM_BxAmFnDg@\\{AbAuJzEsR~JgDlBi@Z_Bx@gBrA{O~IgRnK}@h@_@Tc@ZuChBeAh@{Ar@cSzKaCrAn@bDrMrm@b@t",
    "Cj@nCjI`b@gZdb@iA~A_B~Ag`@xe@kB|BtDfNX~@tAvErAbEX|@pC|IfG`Rt@|BVx@t@rCz@bD|AvEdFzO~@vCf@|BxI|XxA~Dx@",
    "xB|HvUv@|Bx@lChApEpKx[tAfEhFfQlAxEpArDxEfOt@xBr@|BtDlL`A~CdAjDnFzQvDbMlAbD\\rAPp@|FbRpStp@jAxCPp@pAbE",
    "`CkArCuAfB{@RO|YmN`JkE|Aw@lWaMn@c@xAu@RInB_AzE_CfAiBpCUv@a@lc@gTRKd@UdB{@hB{@ZOd@UdN}Gv@_@tIgEXYn@Oj",
    "@ONEv@Sr@Kn@MnBGhAtAr@RrBfC`A~AZh@R`@`@jBj@|Ab@d@DTJ^vIpWf@pATl@r@fBhAxCbE~In@tARt@BfAbA~Bb@dAx@nB`@",
    "AJTp@pAlFxLbXbm@lAnCtFbMlGtNVn@Xl@vPt_@~J`VpCrGhAjCdFnLnAjC|CtHtCrG`MvWnBlEd@dAbCrFhL~VtFdJtAtB|@~@n",
    "FnE~H`D`JpBrWjAf@@nAD~Rp@dPj@jFLX?|BF|ERrl@bCr[fAlHj@pFjBhCzBd@j@~CtE~@`CZx@Vr@lA`Hv@fMnFnwAj@|KBdDf",
    "@lN\\nJ`@zIb@fI\\zHDxB@b@d@hLPnE^lID|@FjAFfBhAfXn@rPRfFRpEHrBZtIVhIb@dKh@tMhP`cE|Cdz@l@pNvAp]`GfyA\\dI@",
    "h@B`@NtDHvBzDbaAzCnx@rDr{@fOtvAvMriAnAjLj@dF~AdNhA~Jx@lHf@tEsKmB~ItIxBtBNfBhEn^HdAVlCt@dGRlBL~Ef@tJF",
    "nE?fCDpB^tNy@hIcBpJcBvGqDfJwE|HkG`HaLrJwNjJ}GbEcMjKwHlKgE`LcClHgAvLIfIp@lKlG~M|EjEfCdAnUnIpJdGhG`MjD",
    "vOf@jBjBfFtGxh@vBlOEjLGxAuAzBw@tCI`AMbBLhDt@fDzAlCvB~AfCh@hBrFfFvOzArJTlEpB`OnAlI~C~SRtAlCxP`Lbt@zHh",
    "f@`Jpl@~Hdg@jDvTpErYh@rDvDlVfA|Gn@dEh@dDxC~P~@nGfBjLmFhB_InCcCx@r@nCxChLbKz]r@`F|AS|JqCd@ShA[y@oFyGi",
    "b@gA{GQiAo@yD_DyRkCyPOcAgA^xC~P~@nGfBjLV`BZzAlJfm@r@jFrAfIpJnj@dBjMnF~]nJtk@\\~B~G|b@`GtZxBzNl@tD^`Cj",
    "BlKnb@hlCpUl~AvOhgAF`B~]ffCvVxgBlAxIpPfkAhEb\\D`IzBtPPnCCtBGt@IvBu@nAg@zAWdBGnCVjCp@~Bv@pAbA~@bBr@jBL",
    "jBY~A_AfAsAfClCNPvB|F`@pCrd@nfDjZzvBtLmDxf@sNvF_B~^sKhCu@tK~@zAxAjBj@pBGz@|GpGte@fAzHnDpW~AjL|D`YLv@",
    "hIll@r@|EyB`AcBnBcApCa@fDXfFeI|BwF~AcpAf^i[bInBjILf@nYlhAjBdHja@lyAtFhRbClCnFjWnE~RvBxJxJpc@bCvK~BlK",
    "VbAjF`SvExSpAxFd@tBd@bFzFjYhLri@^bBjHl\\b@~Cl@bGZtET|DFdAwAxAaArBi@fCMnCLlCh@hCn@rAP^vAxAp@bHX~GRtRx@",
    "rw@B`CDbCzBzcAB~AB~@F|CXpNnB|mAD|A@LDlAHbDd@xG~Cfk@ZnEvAjFn@bCnAhAVt@`AtBj@pCf@~CfBxPp@rGlA~Qh@fFdBj",
    "Nn@pFh@hEPlDOfDE|B_@rB?xB\\tBx@|Az@r@|@Z|BtHRpAx@xFzDrWzKbv@~CvVpAjNdAdMlDxp@rLr{BjDbo@~Azb@?h@GzEDlA",
    "y@x@m@dAc@zAQbB?tBb@jCl@vA^f@h@tGL`CBl@NrAJvAPvCLnBZbFt@fLLlBzBn]hB~MrBhOpLtk@bAzElWxiAhA|EnLfj@dB~H",
    "fFxUnFrVrDzP\\vAnCvMRxC?tBDlAV|At@jBjAnAfAn@|AJhAtC\\`AfAdDpVhhAzPbv@r@zDhFlYtAtLZzFb@nHPfCBpCHvAU\\Q`@",
    "Md@If@Cf@Ah@Bh@Hf@Jd@P`@R^LNNNPLNJTfSdAnWbCp~@zAzf@bAz\\Bv@xA`j@NbF~Anc@dBbW\\dF|@jKpFdn@TpCx@fJ~@zJf@",
    "zEpFjh@vAnMdA|IxB~P^|BvAnJkAb@SHm@h@k@z@_@|@xAhJF`@BRPbAp@jEr@fEfBfK`@p@h@d@hCfANF|@`@fOb`ATxAl@|DlF",
    "n\\pChQ^`CxEfZdBhKhDvTbBnKxFj^nDrWbAdPV~Vb@jc@JjNNrMbAtcA~@nbAv@l^@ZZjPBpGMfBYpAc@hAcBrDwA|@cA`Bi@vBK",
    "`CR`Cp@rBhAvAxB|DzA|FlA~Hd@tE^h`@HxJJn_@IfPIfQWrh@GpWeA|Kk@fHc@bHE|_CGrW?\\@zHDrHj@fPrAj`@?r~@@tOv@|U",
    "hArIZdC|BfKd@rBlNhl@|F|VhBzIjBxLTtGDrEH`KGto@Bf[?xDHbC^hK~@zNxAtM`@tClAtIfBnK~RxgAvArHjBvMr@vJZfJk@d",
    "v@QtO[`Km@tKkBjO_DdOoGjRaGrNaLlXeAdC_FnLqy@xpBoM~[qEtNqB~JsAlMe@jMIvQBbAmAfOa@|Ai@pB[~@]|@g@vAqAD{@D",
    "wBz@m@f@gBrC{@xDKxBL~CRfADXpBbE`BrApCt@xD]`CaBtAyBtO{LbP{Kt@i@dCcBp]wWtXyStF}DdAc@pA[Aa@Fc@J]RYZQ\\C^",
    "FXRR\\j@{@p@k@tE}EpPuLdGcFbPmLvAaAdByA`Ay@^z@f@n@n@`@t@Nh@@f@If@Sf@_@`@i@Xs@Je@lAH`@Fj@MVILMHUBWy@iSQ",
    "YOGQ@OHe@\\O^eAhCc@fAi@xA{@U{@@y@Rs@j@i@x@[fAKnABnARjAaAx@eBxAwA`AcPlLeGbFqPtLuE|Eq@j@k@z@S]YS_@G]B[P",
    "SXK\\Gb@@`@qAZeAb@uF|DuXxSq]vWeCbBu@h@cPzKsJk@gBK_AmDmBkCgE_BqAD{@DwBz@m@f@gBrC{@xDKxBL~CRfAC`FK~CYnC",
    "{AfH}CrDmAfAsKzIaGhEat@lj@_BnAiAz@uKfIk_@jYeLrI_\\hVgAx@{GbFiFzDw@l@ga@hZkEbDkFjEuB|AyCzBor@nh@gJ`HoB",
    "zAe@X{CzBcq@rf@}f@n^sBxAiRzMkbAjs@sDhCaHbGkEjE{BzBkI~KgHtOqDhJyC~M{BfQy@vOcAbu@q@bl@]rQe@dF}@bFwAtEe",
    "BbEkClEgC|CiHvDq@\\gAu@sAWqAHmAh@aAfAaMgAeKmEeQyHqGyBgHgAsHf@oGdC{G`E{PfMaExCak@dc@oFbCqHpGqFxD_FhBcB",
    "dAaD{AiEyAsEwDgGqL_EwM_F}OgEeOeCcKuCcNkBcM{AaM{AiJeBuUy@mSSsRE_O`@yUl@{P|@aNpBmUjB}PfHqo@vAsQz@aPf@o",
    "ONyMGiOUmN_Bch@[u\\J}N\\yJt@gKtCaZzC}VjBmJlBuCh@qAzAOxAe@tA{@jAoA|@aBn@qBTcALiAJwBEyBUuBc@oB}@wBoAeB_B",
    "iAgBo@mBOmBLmBn@aBlAsAhB_A~Bg@lCgFjEsGxB{KhAma@pDwTjBqGKyD_@aCsA_AkCaBaCuEcC}GR}DpCeClFo@hHt@zH|ArDq",
    "AtHoEbMu@bD]pFD`E^|DxArE|BnD|DdDlRxMbMbIrJpGjK~IxCbF`CdGdA~EtArJzA`WvAvZt@~f@LlZh@`_@qAjdASff@Bb]Tt[",
    "r@|`@|A`g@jDxn@jDvb@xEfd@`E`[xFb`@|E`XdIfa@dLhe@pFjSdEpNlAbE|HbV~HnUxIdUvMf[dVxg@pRj_@tVzc@pk@j`AxSp",
    "[tXha@nh@vs@v\\jc@v[`b@zc@hk@zWj]bInKjIzKnUd[jY~`@`StYxTz\\fSx[ba@fr@xf@z~@`IrOrFbLnOv[tJdTnYbq@rIvSvM",
    "r\\pJnW~Svn@Rj@pJtYtAhExHnVbAlDfHtU`F|OrIv]bF~UbPf}@rG|c@xEpe@vDpe@zB`c@tAla@t@h^Ffg@y@bg@{@tWyAj]iDz",
    "m@uB`\\eCtXuIpl@{Hnd@gKzg@uD~PcFlRmFnQkEtN_EtLaG|OyPnb@aKdTmPx[s@vAq[jj@y_@hg@gb@ni@iYh]eEfFiKpNwQzYa",
    "g@~fAoTxb@cGfKcHrMcWhb@aBbJyYbt@yBnFkTjg@iJvRwDhHgEhIiQ~[_Y`d@wY`e@aLxQgEhHeE|H}D|HqDtHgDpIyCdIwDpLs",
    "BpH}BlJqBbKoBxKoAnJmAhKy@tJs@`Kg@bLWdLK~J?nKL`LZlKh@nKb@bJh@fHlAfKjBzL~BpMrBtJvB~IlCnJvCdJxC~HfDfIzD",
    "fI~DtHbEbH`FtHvEnGfFjGbFjFnFhFbGhFzFfEtGfEhOfJnP~I|`@lUtOjKvNhLlNxMhN~NjNnQ`L|P|KhRrJ|RzIvSdIdUhJ`Zz",
    "DrOzFtVjFrVrEtVjHnb@tPx{@nExX|DzVfEpV~E|UrF`VvFvUfGbU~GhUlHlUpHnTnH`SpMl\\tGjNla@f{@fp@laAbIhJvOlQr`@",
    "fd@|pAzlAxd@bf@~]hc@r]ph@j^to@nb@~`A~Slj@fa@~hA~X~q@vZbm@zTf^nQtWnZp`@bn@tu@rkAfsAnn@zaAtYfn@lOp\\p\\d",
    "bAvZrwAdSr`BzHp_BQ~eBuH|dByHpkB\\npBpDhx@bGjw@zF~n@pKxvAzC`o@dB|n@Vl]q@znAuCnoDdC`eA~FrjAzDtg@fDpn@bC",
    "hr@v@jgAFfWyEp`BaEvw@sBbUqD`]w[h}BgChO}N|xAaGbhB`CllB|MdaBdWj}Ajc@b`B|f@loArSv[ha@dr@ns@zw@nw@|q@`fA",
    "dm@pzBfv@|pAtf@xcAtl@js@hq@`s@b{@rl@hfAh_@x~@jg@fbBdf@neBje@fkAdBhE`EpHj\\zn@nNnUzu@bjAzk@nhAnd@|vA|^",
    "zcBvP|}A|KnmBpJtxAbEvj@zJnx@dP`~@|Pxv@|h@jnB|Mfe@xSt_AhIxe@nBbL~E`]`Eb^|Fto@r@|JzAbWzAnW`Cbl@tH`dBfE",
    "ho@~F`l@fFhb@|Ixj@rD|ThE|TzKfe@dMlc@|Kd`@p]ddAxLn_@jLl`@dHnWxJ`b@rFvYbJvm@fKnaAfDpl@hBtm@j@r|@m@j|@s",
    "JxeC}@|s@Eht@d@rr@nBdk@pDfo@pGps@tBxS|C~TjKjq@pJfe@`Pvn@~M~f@vMr_@pEpMlXhq@zTze@hTx_@hYld@ja@tg@ra@j",
    "e@td@rd@fXfXd]l]pf@vi@|TdZb[fe@vRj\\zQb_@`Rpa@nQ`e@hIrUxG~RlHdXxRju@hQxw@rj@`vBx_@tcAxIlTfp@blAxv@jeA",
    "`gAzcAfTfQvWjSr[bUrf@``@|TlSxUfVfG|GzKtMvYz`@lRh[xIfPlHhMpGhMvLxWdGxN`Np_@xHnVzN|i@lNtq@nKdr@bHvo@fF",
    "nu@lBxm@n@fo@Ozn@k@bWy@pWkDjn@_Hbp@_Gh`@oPx}@cNti@cM`b@kVlo@sXjn@wVpc@}_@fr@e`A`uAadApvAgg@lu@gOnXsT",
    "lb@_Sjb@gTth@wI`VgHbTmLt^wJ~^oHrZwIxa@}Pj`AuNdaAcPrgAqOn_AuIzb@uGnZeIj[iIhZsQbl@sKh[uKjZsUdm@cJjTu]x",
    "|@aRdh@aLv\\gJb[eH|XcHvZeH~]sFzZiGfb@sCdU_C`TkC|WoBlVuBjZkA`XoA`Zm@z][l\\Mf^Vl]h@~[x@vXbAdWjElq@hCtZvC",
    "hY~Dp[jE`ZnEnXzExVjK~e@hHzYtHjX`JtY~InWtIfUz]xx@tm@~sAhL|Y~KlZ`Qhl@xMlg@bKjj@bJ`o@`Hrp@hBtXvBl`@x@lW",
    "~@nb@FnYCbZUhZy@hZ{Bzi@gFx`AuDzx@qAx_@cAz[oArs@a@~YOp[Ot_@Lla@Xl]f@`_@vB|u@lAxZpAxX~AtXfBhW|Gf{@nD`_",
    "@vDf]dLd|@jMjy@pMfw@nd@viClQjgA|Hti@`H`h@jJtx@vH~v@zDre@pDpg@dCpb@vB|a@fB|b@tAxb@bAnb@t@|b@@|Zr@jj@E",
    "jc@Mlb@[`c@q@rb@{@rb@oAvb@}Axb@uBhb@cCpb@qCza@wEfn@yF`p@gG`p@sGlp@}Gjp@wGzo@mFlg@cI~x@eEnd@wJdiAoJrj",
    "AaD`d@qC`d@wB|a@yAtZqBfe@}Afd@sAzc@wEbl@qAvl@WbKg@nGo@bFcApF{AjFsAvDsBxEiBjDqOvToGdJuBhDsBvDmBfEeBjF",
    "aAlE{@tFYdFBxFXxFt@fGfAlFdBrE`CzExBrClClCzCvB~CjApDv@|Cb@`ELjDA|DInE[pDe@|Ds@pFuArDwAlGoChPcJhKwGfMw",
    "G`JyDhO}E`HkAdHy@ta@_E~D]bD`@pC`A|Ar@~A`A~CjCpBtAzBn@fCEzBk@|BgB~AqCx@yDTaE]eEs@yH?iBHeBXsAf@eBjLoOl",
    "EcH|EwIjFyK|FiNdGmP`E{M|BuI`EwPjB{JpAuK|@sJVqGp@uUEiPWiLIqGDqGPwEh@qE|@yDlAyD~AeDzBaD~BwB~B}AvCiAhD_",
    "AfDg@dE]xDQtFCjFB|ELvF\\dFr@lFbAxFtAzJpB|JzDhGvCbH|DvWlPbYpQ|J~FxGlD|EpBtE|AdEhAfEz@xEn@hFn@vKZrEC`FO",
    "~DYdFs@pE{@dE{@fNgEl|@cZtr@yVh]}LjN{EvoAec@rZ}JjQuFjC{@~Bh@dFjAfCLrAGjA_@^Y^Wr@iAf@sAd@_Cf@kC|O}FbNy",
    "EhP}FlUcI~GkD~s@oWrZ_K^M~_Ae\\tb@kOj@SxAg@fJeDjQk@rEyAbZuJ|HiC~GqCzD_B`Cm@fDUdAz@dAh@r@RfARbABfAGbAQt",
    "Ai@dAs@~@aAfAkBx@_CVsAPeBDqBpH_Fth@qQpH{CzV_KxBgAdEsBtBkAXRZNZHh@Dh@Cf@Ob@W`@a@LSLUjBU|Bk@xA]fCk@~Fw",
    "Dtj@{S~EkBpB{@f}@wZxEaBpOsF|WkInCIbAU~CRtC|@dE@LVLTZj@\\f@^d@`@b@`@`@b@^d@Zt@b@x@\\x@Vz@PXFXBXBx@Bz@Ax",
    "@Ev@Mx@Qt@Wt@]r@a@p@e@n@k@l@q@h@s@Zg@Zi@Vi@Vm@jDc@hFCd@HfBZ`@HpHdCxGpB",
  ].join(""),
  "to-vilanova": [
    "m{slmAqp~jAfIbCtBn@|Bp@tBeBrBoAfCeBxAqAf@aBlAwGpIql@y@oIwy@nZgG?]E{BY}EaAuDq@W]W]WYYY[Y[Ue@]i@[i@Ui@",
    "Uk@Ok@M{@M{@E{@A{@Dk@Di@Ji@Ji@Pi@Pg@Ve@Ve@\\i@`@g@f@g@h@c@l@a@n@_@r@[r@[v@Wx@Sz@Q|@O~@K~@I~@Cp@Cp@Ap@",
    "mD`EyCdE{@r@q@j@{BjB}WjIqOrFyE`Bg}@vZqBz@_FjBuj@zSkGm@aCFeIFWa@[]_@U_@Mg@Gg@@g@He@T_@Z]d@Sb@Oh@mFpHg",
    "Ad@}TlJmm@hTmChAm@VqGrBsDRc@kAq@oAg@q@u@s@eAq@iAc@oB[yA@iANk@N_A`@_An@s@r@q@~@u@vAk@lB[hBeAzFyAxCsGp",
    "CykA`b@{c@`OcBn@qf@dP}Z`KoBn@iXdJeRfDeZvKwIpC__@pMwTvHsDpASDcGlAqGLmFw@mGgDmJwM`CnIv@jFBnCMxB}@|Di@r",
    "AkA`B}B|AwMhIi^rM}l@vS}q@~U{pAfd@ej@nRqPxF}GzBgInBoIzAwIz@mLPsJ]qE_@oEo@{EaAaEmAkEuAwEiBgFoC_UeNub@g",
    "XyJuFcIqDcHsCeE}AcOuFoGqAsFmAoEkAmCeAaCuAmBaByAiB}BmDeCmDsCsDoBsBaB{AoBoAgC_AcCe@sBSgCEgCPoCl@cC~@gC",
    "nAkBlA_BtAaBlBoAzBoArCaAdDg@tB_@~B]fCQ~CG`D@rDPvD`@bFxBxOlBbNnBbPfAlLVpFLvFNnUWpG}@rJqAtKkBzJaEvP}Bt",
    "IaEzMeGlP}FhNkFxK}EvImEbHkLnOsGzC_Ab@iA`@{Dz@sAl@}@^wBfCsDbEwAl@iEbAuI|@mL`AwSrB{H|@gH~AsSzDeFd@uF@_",
    "FOqFoAsEiBuDeCwC{CaCaEsBmEmBmFcBwFwAoH_AgIm@kJWyICiKX_[XgSVoP`Ami@nAef@vAgc@Fys@fCqi@bDmm@hC}d@hCqd@",
    "xCmd@bDwc@zDcd@`Gkp@tGqp@nBsUbEa^tI_y@zKqdAlKoeApFam@|Ecn@nCwa@`Cac@xBsb@dBab@pAqb@jA_c@p@yb@`@qb@T}",
    "b@Bqe@Dks@s@aWu@ee@kAke@yAwd@kBce@eC{d@kCkd@iI_fA{H{w@_Jav@}Gog@aH{e@aSynAkd@oiC}RemA{Ged@}AaKgIan@c",
    "Ey_@gDk]aG_u@}Bi]_Cea@{Bsi@wBuv@w@yq@[mg@Fcf@P{W^i[v@qg@zAii@~Bal@tCul@vDit@fDkx@tA{s@Rqs@e@u^w@k[eB",
    "e^aC_]sGcp@oJqp@qKgj@sFmTmG_UmSeo@{Xau@cUcg@qYon@wR_c@uI_T}GsR_JcXyIsYgQsp@eNqn@sDyRgDiSkGgd@uEcb@kD",
    "s`@eB_VgBwYgAsXy@}Vq@k^Iw_@@y\\Zk[x@qZ~@oYvA{XlB{ZpF{m@~Fig@vEk[dEiWdJwe@hIs]jIg\\nIiYlK}[jPyd@tf@qnAr",
    "Yku@tKiYxK}ZnQ_l@fTaz@jGsYpIya@nGg_@hGu`@bSauApLyt@jQi_A~Hu^`Ia\\~Jo^pKc]`Rci@bImSnNs\\dNmYbUgc@|OaXlh",
    "@gw@~`A_uAv}@yrAbg@gz@nQe]lY{o@pVmq@hMw`@jNmk@dP_}@lFcb@fGao@vBsWpAgWvA_q@n@}n@s@}q@eB}o@uEst@oHwr@a",
    "Lss@oNoq@{Oil@cRgj@gUkj@eLqVoGgMuEqJ}Yad@cVg\\wVwYqSsSaWeUg|@kq@sq@ah@{L_Ko}@k~@{s@kcAam@ygAqLwT_^cdA",
    "sj@}sBwQuv@{R}w@cIgXyQii@iR{e@qSyc@aUkc@iV}a@cl@}w@}e@sg@e]k_@ut@wt@{G}Geb@ye@ab@ei@qj@e`A_Uad@mYgq@",
    "eEcM{Ngc@kM{c@uY}pAkKon@eEy[oB{P{LaaBcDs_BtAciBzI}dCzAqgAuAeaAgByg@wC_e@eJcbAkJan@iMom@qO_l@sSkq@}E}",
    "Ns[q`AqZ_cAkM{j@_Ksh@_Hud@{Fac@yFem@cE_n@oHidB}D{y@iEyt@yFin@sJiu@}CwRqCsOuC_Q_Ooq@gTqw@uI{[_^krAsPy",
    "t@_Py|@qJiw@sEai@iIuxAuK}oBkPo~Ai_@chB}b@qxAsl@wkA}u@qiAmOeVeYkg@sIyOyg@ilA_g@icB_g@icBo^abAyk@yeAos",
    "@g}@ay@qt@uaAmp@kqAih@kyBeu@seAgh@ou@_r@ur@qs@qa@mq@yS_^ig@{lA}b@k|AsWw{AwNa_BmCgjBlGgiBfNawAt`@mkC|",
    "Di`@tBqUdEgw@nEo`BEkWm@_gAaCsq@_Ewp@cF}{@kEuu@sBgfAGqnAnCq`B\\k~@Ook@qBau@iCon@aI_bAyHkz@}Fww@cEk~@sA",
    "_nB`J}kB~HqfBV{dBqHeaBqSkdBg[gxAu]ceAcNs[q[ul@ip@idAsjA_sAsm@eu@yk@ay@km@mlAq}@c~BmSsg@if@ycAi\\wl@g\\",
    "uh@ydAekAcnAimAkk@im@_IoIwD_E{s@yeAkj@{gAoNy^aIqTeHiTeHgUsGyUcGmUuFcVoF{WuEiWgEyVuGyb@sGic@sGec@gHqb",
    "@ePgfAyJ_a@gGyUuGwU}G{TkHgTeIwTsI{SaJoSoJ}RmKkS_KkQcL_RgLeQmL{PsYab@uE_HoEaH{EgIuD_HaEcIsDsI{CsH{CuI",
    "sC{IkCiJiBaH}A{GsBuJaB{J}AkKoA{JcAcK{@kKm@_Lc@kKWcKMqKAiLF}JT}K^mKl@uKr@aK~@kKnAmKtAcK|AuJlBiKlBmJxB",
    "qJ|BiJnCcKbCqIrCgJlHwT`IkTfI_T|Ns^dT{h@rBaFlZ}t@tE_L~\\gy@jX_h@xg@adA|FyK~GaLz@sAtAiBdA{AfAwA~B}CbEwF",
    "nAcBrUaZ`]y`@tD}EzCcFxWm^bOaV|I}O~CsFdQu\\rLkWtQqc@~FoPxDmLxE_OlF_RvE_QxDmPrK}l@|Hgc@zIyj@~Eki@jDec@n",
    "Cio@p@w^^iULyc@c@aa@sE_sAqD_l@{Fwe@aF__@oE}[oLqk@oGsYiIg^wP_k@oFsRgBkGqa@aiAqPod@cHaQwH{PiTig@ca@c|@",
    "sP}\\oVee@mYch@el@_aAwWu`@{Ty[iu@ucAoUmZip@sz@cUsYgZs`@qYa`@oc@kn@mYyb@wR}ZiWub@_Xie@gLmT}J}RiKcTwNc\\",
    "{I_TwF_O}FuOwGoSaGuRkKi^yIm^oPqy@_EuViIwm@gFag@kDyd@kDkp@aA{n@]ok@?yb@b@yq@hBoMn@sQtAwSrBoTfDqX|E}]~",
    "@eIj@sI?mJa@uIoA}IcBcHkBmF{CuFaCmDwDqD}IcHgf@e\\iHuIsFeE_NoHeDk@qDy@oC{Dw@yCm@uDKkE\\{FhCgIjB}DzAuBrCu",
    "BhDl@|CUpDoBvB}C|AqGrCuC~CyAtFuAvTkBla@qDzKiAjHJxCrAxAv@dAnC~ApBvC`BdD\\zAOxAe@vEpArE`ChFl@nFPpHGjK{@",
    "rHe@dJWbI@hHb@lLpCzHnCjD~BfHzHpGdHfB`AlHzBKjBZdDt@`B~ArAdBX`@CvAa@jAgAz@{BB]fIzB`GxBzFfAfHf@zJc@rEq@",
    "vEyAbI_EfEqD|@z@x@t@~@|Ct@bHr@dKw@bJmCtL{CfHaElIw@|Ag@bAe@pAIbAJdAt@zAxCrBfC`Bz@|B@bDMlC{BvaA@rIhBxG",
    "rKha@tArF|@zCtBGtEErEIvGLnIr@~@\\tA|BDJt@`BRxHJpD`HcGrDiCjbAks@hR{MrByA|f@o^bq@sf@zC{Bd@YnB{AfJaH`BoA",
    "lo@_f@xC{BtB}AjFkEjEcDfa@iZv@m@hF{DzGcFfAy@~[iVdLsIj_@kYtKgIhA{@~AoA`t@mj@`GiErK{IlAgA|CsDlLaIXSbFyC",
    "`CaBtAyBtO{LbP{Kt@i@dCcBp]wWtXyStF}DdAc@pA[Aa@Fc@J]RYZQ\\C^FXRR\\j@{@p@k@tE}EpPuLdGcFbPmLvAaAdByA`Ay@^",
    "z@f@n@n@`@t@Nh@@f@If@Sf@_@`@i@Xs@Je@lAH`@Fj@MVILMHUBWy@iSQYOGQ@OHe@\\O^eAhCc@fAi@xA{@U{@@y@Rs@j@i@x@[",
    "fAKnABnARjAaAx@eBxAwA`AcPlLeGbFqPtLuE|Eq@j@k@z@S]YS_@G]B[PSXK\\Gb@@`@qAZeAb@uF|DuXxSq]vWeCbBu@h@cPzKs",
    "Jk@gBK_AmDa@qGGiAA}CAiFKuLCcAHwQd@kMrAmMpB_KpEuNnM_\\py@ypB~EoLdAeC`LmX`GsNnGkR~CeOjBkOl@uKZaKPuOj@ev",
    "@[gJs@wJkBwMwAsH_SygAgBoKmAuIa@uCyAuM_A{N_@iKIcC?yDCg[Fuo@IaKEsEUuGkByLiB{I}F}VmNil@e@sB}BgK[eCiAsIw",
    "@}UAuO?s~@DafA@m`@RmvCFqWVsh@HgQHgPKo_@IyJ_@i`@BcANqGNaL^uGz@uBZkCIoCo@aCkAeBM}BEaC_@ia@GsKeBazCEiGU",
    "sS}@g|@a@kIk@gHkA}JuAyJwB}MwJcn@a@gCiBiKu@wEiBcLy@gFo@kE[uByEu[_AiGwA}IsFo]kAoHeJkk@k@gDo@oEo@qDkGqb",
    "@_D_VIg@iBoP}Eid@W{BcBaSu@{HiD_^}A{QuAeTg@uH}@uMmD_jAQsGEcAgDkfA[{HuAqf@aB{e@KaFG{GCoBXMVQRURYP[J_@J",
    "a@Da@Bc@?c@Ac@Gg@Ke@Oc@S]W[YWkCcJe@mGm@aHaByMwBwMgBmJmC}MiJca@yBiKoLej@qHi]i@mCa@sDCkBp@cA\\wAJ}@ByCe",
    "@oCgAwB{@u@yAoEcCiJWkAoB{Ia@oBuBwJkEcTcBoIkAgFkAiFiLoh@i@yBoAuFeBcI_Ocq@iEgTiFqWkE{RcAeFq@aFwBwQyByV",
    "]}G_AyQMuDQgEW{GKiCd@mBJyAA{AMsAc@aBq@kAm@q@s@c@iAwCk@wCsE}|@sHonAmFgcAiBa]_A_QcA}N}AiO{Hsj@iF{_@wCm",
    "ScB{KCi@MwCPaGHwAXiANeBGeB[}Am@qAg@i@m@_@kDkGoAeFAKKs@oAyI]mCo@_F{EoXq@sGgByP@aEi@wHK}DwBiW{@mSc@_KE",
    "aA]oHK{F{BqqAK}Eg@gZIiEUuPSkMe@s[QoJk@a\\[cNc@iTJ_G^kEJiAnAoAbAsBj@gCLqCMqCi@iCcAsBwAyAeBw@mBSeAsHeAk",
    "HeBcIo@iCmFyV]aByFeViI_\\eGuTe@uBqAyFwEySkFaSWcA_CmKcCwKyJqc@wByJoE_SRuSKkIAk@C}Ci@yHsMom@i@_D{Hg]EQ_",
    "Lee@_@qC}Ruz@mRauAoC}RgX_lBkZ{vBsd@ofDa@qC_@gFEk@q@mE_@wBy@oABqBOqBg@sBy@cBkAmAwAq@aDeHmBsFeF}SiEc\\q",
    "PgkAmAyIwVygB_^gfCGaBwOigAqUm~Aob@ilCkBmK_@aCm@uDyB{NkDo\\{G_b@a@kC_K{k@eMiw@gGk_@iA{Hy@oFyGib@gA{GQi",
    "Ao@yD_DyRkCyPOcAuA}IiAkH}DgVi@oDkE_Zw@gF}Lww@mIkj@{Fa]uMqz@sCcSg@yCq@kEsAcIyBcM{B_NaAwD{AsJ_@_OD_EB_",
    "B?qBhAcBv@iCZcCByC]{C{@mCuAqBcAsM@uPz@wRbNksA`Fsf@z@sM^eQ[mT}A_U}BgV_BqPgAkKgA{J[}D[}CaCsYWqCq@_NHa@",
    "Py@j@s@tASxAg@tACnu@cKhFm@tFkCgEws@u@gMlXmDzAe@Fu@Tm@^a@f@Qf@@d@R\\b@Rn@Dz@Kx@Yn@g@^m@Fa@I_@WWa@Ok@Eo",
    "@{Ad@mXlDt@fMfEvs@uFjCiFl@ou@bKuCqAmBkAeAqAgAcAcAuA}A_BIeAiEo^OgBc@yDKk@UwBg@uEy@mHiA_K_BeNk@eFoAkLw",
    "MsiAgOuvAsDs{@{Cox@{DcaAIwBOuDCa@Ai@]eIaGgyAwAq]m@qN}Cez@iPacEi@uMc@eKWiI[uIIsBSqESgFo@sPiAgXGgBGkAE",
    "}@_@mIQoEe@iLAc@EyB]{Hc@gIa@{I]oJg@mNCeDk@}KoFowAw@gMmAaHWs@[y@_AaC_DuEe@k@iC{BqFkBmHk@s[gAsl@cC}ES}",
    "BGY?kFMePk@_Sq@oAEg@AsWkAaJqB_IaDoFoE}@_AuAuBuFeJiL_WcCsFe@eAoBmEaMwWuCsG}CuHoAkCeFoLiAkCqCsG_KaVwPu",
    "_@Ym@Wo@mGuNuFcMmAoCcXcm@mFyLq@qAKUAmAo@wAa@_AgAeCk@OSu@o@uAcE_JiAyCs@gBUm@g@qAwIqWK_@EUY_DIsA?a@@o@",
    "Cm@AwCCwCb@qAV}B?eAa@kCM_@Yk@Y_@a@_@cBc@kBMM@m@RA@m@`@i@|@IPs@|AM|Dw@x@OVe@r@sAjAQNg@b@i@d@YXuIfEw@^",
    "eN|Ge@T[NiBz@eBz@e@TSJmc@fTw@`@qCTgAhB{E~BoB~@SHkAl@MFo@b@mW`M}Av@_e@xTSNgBz@sCtAaCjAqAcEQq@kAyCqSup",
    "@}FcRQq@]sAmAcDwDcMoF{QeAkDaA_DuDmLs@}Bu@yByEgOqAsDmAyEiFgQuAgEqKy[iAqEy@mCw@}B}HwUy@yByA_EyI}Xg@}B_",
    "AwCeF{O}AwE{@cDg@oBMc@mAwDgGaRqC}IY}@sAcEpCkCh@c@vDqDnE_EtD}CfKwIr@c@lCmBc@yAs@{BeCaJwCuMq@qCkLye@EM",
    "WcAYsArBaBbXoTf@g@d@g@hBcAxAgAl]uWp@k@n@i@`Ao@f`@i[rBcBa@iC}CcMo@iCqDyNaAaEw@wCqHmZyEuRsDaPY_BCaBZQP",
    "MxMmHdFsCbKoF`CuAz_@iSbAo@lDkBfCuAhUmLhEiC|LyGxAw@dAg@dBu@_AeFc@wBsHy^_Jwd@UyA}@wDw@wDsG_\\iBuJq@uDy@",
    "{DeA_F_@kBaDuPkHi]QaAcAkFiAgFWuAsCwNs@sDkAyFgDwPUcAiA}FgAmFUoA_D}O}AmHpBu@ZM|w@_]lKqEzBaAmAiGUkAw@mE",
    "_AmFa@qCkAiHiAiHq@cE`FuBnAg@jCp@r@LrBz@fA`IdAfGfA|GNz@",
  ].join(""),
} satisfies Record<Direction, string>;

function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const readDelta = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result += (byte & 0x1f) * 2 ** shift;
      shift += 5;
    } while (byte >= 0x20);
    return result % 2 ? -(result + 1) / 2 : result / 2;
  };

  while (index < encoded.length) {
    latitude += readDelta();
    longitude += readDelta();
    coordinates.push([latitude / 1e6, longitude / 1e6]);
  }
  return coordinates;
}

export const roadShapeByDirection: Record<Direction, [number, number][]> = {
  "to-tarragona": decodePolyline(encodedShapes["to-tarragona"]),
  "to-vilanova": decodePolyline(encodedShapes["to-vilanova"]),
};
